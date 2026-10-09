/*
 * Ready-made blocks for the blog editor's "+" menu in the content manager (/admin):
 * a "Book a call" button, a highlight box and a table.
 * Each block is saved into the post's markdown as plain HTML / a markdown table that
 * build.js renders as-is; `pattern` + `fromBlock` read it back into the block's form
 * when the post is opened again, so toBlock's output and pattern must stay in step.
 * Their look comes from the .post-cta / .post-callout rules in assets/css/tailwind.src.css
 * (never Tailwind utility classes: posts/*.md isn't scanned by the Tailwind build).
 * The block ids are listed under `editor_components` in admin/config.yml.
 */
(function () {
  var DEFAULT_LINK = '/?contact=1'; // opens the booking form on the home page
  var DEFAULT_BUTTON = 'Book a Free Call';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function unescapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  }

  // ---- "Book a call" button -------------------------------------------------

  function ctaHtml(data) {
    var lines = ['<div class="post-cta">'];
    if (data.text) lines.push('<p class="post-cta-text">' + escapeHtml(data.text) + '</p>');
    lines.push('<a class="post-cta-button" href="' + escapeHtml(data.link || DEFAULT_LINK) + '">' +
      escapeHtml(data.button || DEFAULT_BUTTON) + '</a>');
    lines.push('</div>');
    return lines.join('\n');
  }

  CMS.registerEditorComponent({
    id: 'cta',
    label: 'Book a call button',
    fields: [
      { name: 'text', label: 'Text above the button', widget: 'string', required: false,
        hint: 'e.g. “Need a bilingual intake specialist this week?”' },
      { name: 'button', label: 'Button text', widget: 'string', default: DEFAULT_BUTTON },
      { name: 'link', label: 'Button link', widget: 'string', default: DEFAULT_LINK,
        hint: 'Leave as is to open the booking form. Or paste any page address.' }
    ],
    pattern: /^<div class="post-cta">\n(?:<p class="post-cta-text">(.*)<\/p>\n)?<a class="post-cta-button" href="([^"]*)">(.*)<\/a>\n<\/div>/,
    fromBlock: function (match) {
      return { text: unescapeHtml(match[1] || ''), link: unescapeHtml(match[2]), button: unescapeHtml(match[3]) };
    },
    toBlock: ctaHtml,
    toPreview: ctaHtml
  });

  // ---- Highlight box ----------------------------------------------------------
  // The blank lines around the text let build.js (marked) format the bold text,
  // links and lists inside it.

  function calloutMarkdown(data) {
    return '<div class="post-callout">\n\n' +
      (data.title ? '<p class="post-callout-title">' + escapeHtml(data.title) + '</p>\n\n' : '') +
      String(data.body || '').trim() + '\n\n</div>';
  }

  CMS.registerEditorComponent({
    id: 'callout',
    label: 'Highlight box',
    fields: [
      { name: 'title', label: 'Title', widget: 'string', required: false,
        hint: 'A short label, e.g. “Key takeaway” or “Quick tip”.' },
      { name: 'body', label: 'Text', widget: 'markdown', modes: ['rich_text'],
        buttons: ['bold', 'italic', 'link', 'bulleted-list', 'numbered-list'], editor_components: [] }
    ],
    pattern: /^<div class="post-callout">\n\n(?:<p class="post-callout-title">(.*)<\/p>\n\n)?([\s\S]*?)\n\n<\/div>/,
    fromBlock: function (match) {
      return { title: unescapeHtml(match[1] || ''), body: match[2] };
    },
    toBlock: calloutMarkdown,
    toPreview: function (data) {
      return window.marked ? window.marked.parse(calloutMarkdown(data)) : calloutMarkdown(data);
    }
  });

  // ---- Table ------------------------------------------------------------------
  // Edited as plain text: one row per line, columns separated by | or by tabs
  // (what Excel / Google Sheets put on the clipboard). Saved as a markdown table.
  // The pattern matches any markdown table, so tables written before this block
  // existed open in the same form.

  function splitRow(line) {
    var trim = function (cell) { return cell.trim(); };
    if (line.indexOf('\t') !== -1) return line.split('\t').map(trim);
    var text = line.trim();
    // Drop the outer pipes only when the row has both ("| a | b |"), so a row
    // with an empty first cell (" | In-House | Virtual") keeps that cell.
    if (text.length > 1 && text.charAt(0) === '|' && /[^\\]\|$/.test(text)) text = text.slice(1, -1);
    return text.split(/(?<!\\)\|/).map(trim);
  }

  function tableMarkdown(data) {
    var rows = String(data.rows || '').split('\n')
      .filter(function (line) { return line.trim(); })
      .map(splitRow);
    if (!rows.length) return '| |\n| --- |';
    var columns = Math.max.apply(null, rows.map(function (row) { return row.length; }));
    var toLine = function (row) {
      var cells = [];
      for (var i = 0; i < columns; i++) cells.push((row[i] || '').replace(/(?<!\\)\|/g, '\\|'));
      return '| ' + cells.join(' | ') + ' |';
    };
    var delimiter = [];
    for (var i = 0; i < columns; i++) delimiter.push('---');
    return [toLine(rows[0]), '| ' + delimiter.join(' | ') + ' |'].concat(rows.slice(1).map(toLine)).join('\n');
  }

  CMS.registerEditorComponent({
    id: 'table',
    label: 'Table',
    fields: [
      { name: 'rows', label: 'Table rows', widget: 'text',
        hint: 'One row per line; the first line is the header. Separate columns with | — or paste cells straight from Excel or Google Sheets. Put \\*\\* around text to make it bold, e.g. \\*\\*Total\\*\\*.' }
    ],
    pattern: /^\|[^\n]*\|[ \t]*\n\|[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|[ \t]*(?:\n\|[^\n]*\|[ \t]*)*/,
    fromBlock: function (match) {
      var lines = match[0].split('\n');
      lines.splice(1, 1); // the | --- | --- | line
      return { rows: lines.map(function (line) { return splitRow(line).join(' | '); }).join('\n') };
    },
    toBlock: tableMarkdown,
    toPreview: function (data) {
      return window.marked ? window.marked.parse(tableMarkdown(data)) : tableMarkdown(data);
    }
  });
})();
