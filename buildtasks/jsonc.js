'use strict';

// Minimal JSONC reader: strips // and /* */ comments and trailing commas,
// so hand-edited status-tasks.json files can contain comments like tasks.json does.

function stripComments(text) {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next;
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
    } else if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

function removeTrailingCommas(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] || '';
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

function parse(text) {
  return JSON.parse(removeTrailingCommas(stripComments(text)));
}

module.exports = { parse, stripComments, removeTrailingCommas };
