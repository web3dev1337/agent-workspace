const path = require('path');

function normalizePathSlashes(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function splitPathSegments(value) {
  return normalizePathSlashes(value).split('/').filter(Boolean);
}

function getPathBasename(value) {
  const trimmed = normalizePathSlashes(value).replace(/\/+$/, '');
  if (!trimmed) return '';
  return path.basename(trimmed);
}

function getTrailingPathLabel(value, count = 2) {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 2;
  return splitPathSegments(value).slice(-safeCount).join('/');
}

module.exports = {
  normalizePathSlashes,
  splitPathSegments,
  getPathBasename,
  getTrailingPathLabel
};
