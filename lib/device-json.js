/*
 * Device-compatible JSON writer for Helix .hsp files.
 * Copyright (C) 2026 g3rtg3rt
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General
 * Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * Device-compatible JSON writer.
 *
 * The firmware distinguishes floats from integers by the presence of a decimal
 * point in the JSON text. JSON.stringify renders 0.0 as "0", which hands a
 * float-typed parameter an integer and faults the unit on load.
 *
 * So numbers cannot be formatted by type alone -- "0" is correct for Mic and
 * wrong for Level. The formatting is a property of the FIELD, and the only
 * authority on which field is which is the corpus the device wrote itself.
 *
 *   learnNumberFormat(dir)  scan .hsp files, record which fields carry a
 *                           decimal point
 *   stringify(obj, fmt)     render JSON the way the device does
 *
 * Verified by reproducing a device-written preset byte-for-byte.
 */

const fs = require('fs');
const path = require('path');

/* ---- scanner -------------------------------------------------------- *
 * The files are pretty-printed one value per line, so a line scanner with a
 * key stack is enough and avoids hand-rolling a JSON parser. Context for a
 * number is the enclosing model + parameter, because "value" alone is
 * ambiguous -- it is an int under Mic and a float under Level.
 * -------------------------------------------------------------------- */

const NUM = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const isFloatText = (t) => t.includes('.') || t.includes('e') || t.includes('E');

function scanFile(text, record) {
  const stack = [];      // key path
  const models = [];     // model name per depth, for slot params
  let pendingModel = null;
  let atRoot = true;     // the document's own opening brace is not a frame

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    // The writer starts from an empty path, so the root brace must not push
    // one here or no learned field name will ever match a written one.
    if (atRoot && line === '{') { atRoot = false; continue; }

    // "key": {   or   "key": [
    let m = /^"((?:[^"\\]|\\.)*)"\s*:\s*[{[]$/.exec(line);
    if (m) { stack.push(m[1]); models.push(pendingModel); pendingModel = null; continue; }

    // bare {  or  [   (array element object)
    if (line === '{' || line === '[') { stack.push('[]'); models.push(null); continue; }

    // closers
    if (/^[}\]],?$/.test(line)) { stack.pop(); models.pop(); continue; }

    // "model": "X"  -- remember it for the params sibling
    m = /^"model"\s*:\s*"([^"]*)"/.exec(line);
    if (m) { pendingModel = m[1]; continue; }

    // "key": value
    m = /^"((?:[^"\\]|\\.)*)"\s*:\s*(.+?),?$/.exec(line);
    if (m && NUM.test(m[2])) { record(ctx(stack, models, m[1]), isFloatText(m[2])); continue; }

    // bare array element
    if (NUM.test(line.replace(/,$/, ''))) {
      record(ctx(stack, models, null), isFloatText(line.replace(/,$/, '')));
    }
  }
}

/* A field's identity: the nearest enclosing model plus the parameter name,
 * falling back to the key path for everything outside a params block. */
function ctx(stack, models, key) {
  const pi = stack.lastIndexOf('params');
  if (pi !== -1 && stack.length > pi + 1) {
    const param = stack[pi + 1];
    let model = null;
    for (let i = models.length - 1; i >= 0; i--) if (models[i]) { model = models[i]; break; }
    const rest = stack.slice(pi + 2).concat(key || []).join('.');
    return `${model || '?'}|${param}` + (rest ? `|${rest}` : '');
  }
  return stack.concat(key || []).join('.');
}

function learnNumberFormat(dir, exclude = []) {
  const skip = new Set(exclude);
  const fmt = new Map(); // field -> {f, i}
  /* Recursive. This was a flat readdirSync, so a corpus split into
   * per-firmware folders taught the writer from a fraction of its files --
   * and this is the rule whose failure mode is a device watchdog restart
   * about ten seconds after the preset loads, not merely a wrong tone.
   * `exclude` still matches on BASENAME, which is what every caller passes. */
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.hsp') && !skip.has(e.name)) files.push(p);
    }
  })(dir);
  for (const f of files) {
    const text = fs.readFileSync(f).subarray(8).toString('utf8');
    scanFile(text, (field, isFloat) => {
      if (!fmt.has(field)) fmt.set(field, { f: 0, i: 0 });
      fmt.get(field)[isFloat ? 'f' : 'i']++;
    });
  }
  const out = new Map();
  for (const [field, c] of fmt) out.set(field, c.f >= c.i); // ties -> float
  out.set('__stats', fmt);
  out.set('__consensus', crossModelConsensus(fmt));
  return out;
}

/* ---- cross-model consensus ------------------------------------------ *
 * A field's identity is MODEL|PARAM, so a parameter the corpus has never
 * exported ON THAT MODEL is unknown even when every other model agrees about
 * it. That is the blind spot of inducing a rule from a corpus, and it is not
 * hypothetical: `CabIdx` arrived in firmware 1.4.1 and the corpus carries it
 * on 17 amp models as a bare int, 39 times, never once as a float -- while
 * six amp models have only ever been exported BEFORE 1.4.1 and so have no
 * observation of it at all. Those six fell through to the float default and
 * wrote "-1.0" into twelve presets: an int-typed index handed a float, which
 * is the exact shape of the bug this writer exists to prevent.
 *
 * So when MODEL|PARAM is unknown, fall back to what the SAME PARAM NAME does
 * on other models -- but only on evidence broad enough to generalise, because
 * a rule induced from a thin sample is only as general as that sample:
 *
 *   - every observation must agree (one dissent means the param is per-model)
 *   - at least MIN_MODELS distinct models must have been observed
 *   - at least MIN_OBS observations in total
 *
 * `Attack` is the case that proves the guard is needed: a float in
 * milliseconds on eight compressor models and a bare int on two drive pedals,
 * where it is a switch position. Same parameter name, different kind, so it
 * never reaches consensus and keeps the float default. Nine other parameters
 * are split the same way (Bright, Ratio, MidFreq, Boost, Pitch ...), and 337
 * more are unanimous but too thin to generalise from. Everything that fails
 * these tests is left to the old behaviour, so this can only ADD knowledge,
 * never overturn it.
 *
 * Measured impact when introduced: of 23 presets, 12 changed, by one line each
 * -- eleven CabIdx on six amp models with no observation of it, plus
 * SyncSelect1 on the Courtesan Flange, a tempo-sync division index that was
 * also being written as a float. Nothing else in any file moved.
 * -------------------------------------------------------------------- */
const MIN_MODELS = 3;
const MIN_OBS = 8;

function crossModelConsensus(fmt) {
  const byParam = new Map(); // param -> {f, i, models:Set}
  for (const [field, c] of fmt) {
    const m = /^([^|]+)\|([^|]+)\|value$/.exec(field);  // the canonical rendering
    if (!m) continue;
    const [, model, param] = m;
    if (model === '?') continue;
    if (!byParam.has(param)) byParam.set(param, { f: 0, i: 0, models: new Set() });
    const a = byParam.get(param);
    a.f += c.f; a.i += c.i; a.models.add(model);
  }
  const out = new Map();
  for (const [param, a] of byParam) {
    if ((a.f === 0) === (a.i === 0)) continue;             // not unanimous
    if (a.models.size < MIN_MODELS || a.f + a.i < MIN_OBS) continue;
    out.set(param, a.f > 0);
  }
  return out;
}

/* ---- writer --------------------------------------------------------- */

function fmtNumber(n, asFloat) {
  if (!Number.isFinite(n)) throw new Error(`non-finite number: ${n}`);
  if (!asFloat) {
    if (!Number.isInteger(n)) throw new Error(`integer field given ${n}`);
    return String(n);
  }
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return `${n}.0`;
  const s = String(n);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

function stringify(value, fmt) {
  const lines = [];
  write(value, [], [], null, 0);
  return lines.join('\n');

  function pad(d) { return '  '.repeat(d); }

  function write(node, stack, models, key, depth, trailing = '') {
    if (node === null) { lines.push(pad(depth) + `${key === null ? '' : `"${esc(key)}": `}null${trailing}`); return; }
    if (Array.isArray(node)) {
      lines.push(pad(depth) + `${key === null ? '' : `"${esc(key)}": `}[`);
      node.forEach((el, i) => {
        const t = i === node.length - 1 ? '' : ',';
        writeInArray(el, stack, models, depth + 1, t);
      });
      lines.push(pad(depth) + ']' + trailing);
      return;
    }
    if (typeof node === 'object') {
      const keys = Object.keys(node).sort();
      lines.push(pad(depth) + `${key === null ? '' : `"${esc(key)}": `}{`);
      const model = typeof node.model === 'string' ? node.model : null;
      keys.forEach((k, i) => {
        const t = i === keys.length - 1 ? '' : ',';
        const child = node[k];
        const isContainer = child !== null && typeof child === 'object';
        write(child, isContainer ? stack.concat(k) : stack, models.concat(model), k, depth + 1, t);
      });
      lines.push(pad(depth) + '}' + trailing);
      return;
    }
    lines.push(pad(depth) + `${key === null ? '' : `"${esc(key)}": `}${scalar(node, stack, models, key)}${trailing}`);
  }

  function writeInArray(el, stack, models, depth, trailing) {
    if (el !== null && typeof el === 'object') { write(el, stack.concat('[]'), models.concat(null), null, depth, trailing); return; }
    lines.push(pad(depth) + scalar(el, stack, models, null) + trailing);
  }

  function scalar(x, stack, models, key) {
    if (typeof x === 'string') return `"${esc(x)}"`;
    if (typeof x === 'boolean') return String(x);
    if (x === null) return 'null';
    if (typeof x !== 'number') throw new Error(`unsupported ${typeof x}`);
    const field = ctx(stack, models, key);
    let known = fmt.get(field);
    // A parameter's snapshot array holds the same quantity as its `value`, so
    // inherit that formatting rather than guessing. Without this, a switch-
    // position parameter whose snapshots the corpus never varied would be
    // written as 1.0 where the firmware wants 1.
    if (known === undefined && field.endsWith('|snapshots')) {
      known = fmt.get(field.replace(/\|snapshots$/, '|value'));
    }
    // Still unknown: ask what this PARAM NAME does on other models, which
    // catches a parameter a firmware update added to models the corpus only
    // holds older exports of. Only unanimous, broadly-observed params qualify
    // -- see crossModelConsensus.
    if (known === undefined) {
      const m = /^[^|]+\|([^|]+)\|(?:value|snapshots)$/.exec(field);
      const consensus = fmt.get('__consensus');
      if (m && consensus) known = consensus.get(m[1]);
    }
    // Still unknown: float is the safer default -- continuous parameters are
    // the overwhelming majority and integer fields are a small enumerated set.
    return fmtNumber(x, known === undefined ? true : known);
  }

  function esc(s) {
    return s.replace(/[\\"]/g, (c) => '\\' + c)
      .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      .replace(/[ -]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  }
}

module.exports = { learnNumberFormat, stringify, MAGIC: 'rpshnosj' };
