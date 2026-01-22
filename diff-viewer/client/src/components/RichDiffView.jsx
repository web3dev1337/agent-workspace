import React from 'react';
import './RichDiffView.css';

function renderSegments(segments, flavor) {
  if (!Array.isArray(segments) || segments.length === 0) return null;

  return segments.map((part, idx) => {
    const type = part?.type || 'common';
    const value = part?.value ?? '';
    const cls =
      type === 'common'
        ? 'seg-common'
        : type === 'removed'
          ? `seg-removed ${flavor === 'old' ? 'seg-removed-strong' : ''}`
          : type === 'added'
            ? `seg-added ${flavor === 'new' ? 'seg-added-strong' : ''}`
            : 'seg-common';

    return (
      <span key={idx} className={cls}>
        {value}
      </span>
    );
  });
}

function LineRow({ kind, oldLine, newLine, prefix, children }) {
  return (
    <div className={`rich-line rich-line-${kind}`}>
      <div className="rich-gutter rich-old">{oldLine ?? ''}</div>
      <div className="rich-gutter rich-new">{newLine ?? ''}</div>
      <div className="rich-code">
        <span className="rich-prefix">{prefix}</span>
        {children}
      </div>
    </div>
  );
}

function renderHunkRows(rows, { hideContext }) {
  const rendered = [];
  let hiddenContext = 0;

  const flushHiddenContext = (keyPrefix) => {
    if (!hideContext || hiddenContext === 0) return;
    rendered.push(
      <div key={`${keyPrefix}-ctx-${rendered.length}`} className="rich-line rich-line-context-collapsed">
        <div className="rich-gutter rich-old" />
        <div className="rich-gutter rich-new" />
        <div className="rich-code rich-code-muted">
          … {hiddenContext} unchanged line{hiddenContext === 1 ? '' : 's'} hidden (toggle “Hide Noise” to show)
        </div>
      </div>
    );
    hiddenContext = 0;
  };

  rows.forEach((row, idx) => {
    const type = row?.type;

    if (type === 'context') {
      if (hideContext) {
        hiddenContext += 1;
        return;
      }

      flushHiddenContext(`row-${idx}`);
      rendered.push(
        <LineRow
          key={`ctx-${idx}`}
          kind="context"
          oldLine={row.oldLine}
          newLine={row.newLine}
          prefix=" "
        >
          <span className="seg-common">{row.content ?? ''}</span>
        </LineRow>
      );
      return;
    }

    flushHiddenContext(`row-${idx}`);

    if (type === 'added') {
      rendered.push(
        <LineRow
          key={`add-${idx}`}
          kind="added"
          oldLine={null}
          newLine={row.newLine}
          prefix="+"
        >
          <span className="seg-common">{row.content ?? ''}</span>
        </LineRow>
      );
      return;
    }

    if (type === 'deleted') {
      rendered.push(
        <LineRow
          key={`del-${idx}`}
          kind="deleted"
          oldLine={row.oldLine}
          newLine={null}
          prefix="-"
        >
          <span className="seg-common">{row.content ?? ''}</span>
        </LineRow>
      );
      return;
    }

    if (type === 'updated') {
      rendered.push(
        <LineRow
          key={`upd-old-${idx}`}
          kind="updated-old"
          oldLine={row.oldLine}
          newLine={null}
          prefix="-"
        >
          {renderSegments(row.oldSegments, 'old') ?? <span className="seg-common">{row.oldContent ?? ''}</span>}
        </LineRow>
      );
      rendered.push(
        <LineRow
          key={`upd-new-${idx}`}
          kind="updated-new"
          oldLine={null}
          newLine={row.newLine}
          prefix="+"
        >
          {renderSegments(row.newSegments, 'new') ?? <span className="seg-common">{row.newContent ?? ''}</span>}
        </LineRow>
      );
      return;
    }

    // Unknown row type fallback
    rendered.push(
      <LineRow key={`unk-${idx}`} kind="context" oldLine={row.oldLine} newLine={row.newLine} prefix=" ">
        <span className="seg-common">{row.content ?? ''}</span>
      </LineRow>
    );
  });

  flushHiddenContext('end');
  return rendered;
}

export default function RichDiffView({ richText, hideContext = true }) {
  if (!richText || !Array.isArray(richText.hunks)) {
    return (
      <div className="rich-diff-view">
        <div className="rich-diff-empty">No rich diff data available.</div>
      </div>
    );
  }

  const ops = richText.operations || {};
  const badges = [
    { key: 'updated', label: 'Updates', value: ops.updated, cls: 'badge-updated' },
    { key: 'added', label: 'Adds', value: ops.added, cls: 'badge-added' },
    { key: 'deleted', label: 'Deletes', value: ops.deleted, cls: 'badge-deleted' },
    { key: 'moved', label: 'Moves', value: ops.moved, cls: 'badge-moved' },
    { key: 'copyPaste', label: 'Copy/Paste', value: ops.copyPaste, cls: 'badge-copy' },
    { key: 'findReplace', label: 'Find/Replace', value: ops.findReplace, cls: 'badge-find' }
  ].filter(b => typeof b.value === 'number' && b.value > 0);

  return (
    <div className="rich-diff-view">
      <div className="rich-diff-summary">
        <div className="rich-diff-badges">
          {badges.length > 0 ? (
            badges.map(b => (
              <span key={b.key} className={`rich-badge ${b.cls}`}>
                {b.label}: {b.value}
              </span>
            ))
          ) : (
            <span className="rich-summary-muted">No rich operations detected.</span>
          )}
        </div>

        {Array.isArray(richText.findReplace) && richText.findReplace.length > 0 && (
          <div className="rich-summary-section">
            <div className="rich-summary-title">Find/Replace</div>
            <div className="rich-summary-list">
              {richText.findReplace.slice(0, 8).map((p, idx) => (
                <div key={idx} className="rich-summary-item">
                  <code className="rich-code-inline">{p.from}</code> →{' '}
                  <code className="rich-code-inline">{p.to}</code> ({p.count})
                </div>
              ))}
            </div>
          </div>
        )}

        {Array.isArray(richText.movedBlocks) && richText.movedBlocks.length > 0 && (
          <div className="rich-summary-section">
            <div className="rich-summary-title">Moves</div>
            <div className="rich-summary-list">
              {richText.movedBlocks.slice(0, 8).map((m, idx) => (
                <div key={idx} className="rich-summary-item">
                  {m.lines} line{m.lines === 1 ? '' : 's'}: {m.from?.line} → {m.to?.line}
                </div>
              ))}
            </div>
          </div>
        )}

        {Array.isArray(richText.copyPaste) && richText.copyPaste.length > 0 && (
          <div className="rich-summary-section">
            <div className="rich-summary-title">Copy/Paste</div>
            <div className="rich-summary-list">
              {richText.copyPaste.slice(0, 6).map((c, idx) => (
                <div key={idx} className="rich-summary-item">
                  <code className="rich-code-inline">{c.content}</code> × {c.count}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rich-diff-body">
        {richText.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className="rich-hunk">
            <div className="rich-hunk-header">{hunk.header}</div>
            <div className="rich-hunk-rows">
              {renderHunkRows(hunk.rows || [], { hideContext })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

