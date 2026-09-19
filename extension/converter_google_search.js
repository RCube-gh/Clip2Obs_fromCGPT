// converter_google_search.js -- Google Search AI Mode specific converter
//
// DOM structure observed in ref_google_search.html:
//   User query: div.ilZyRc.R7mRQb
//     └─ [role="heading"] with a leading "You said:" label
//   AI turn: div.CKgc1d[data-scope-id="turn"]
//     └─ [data-container-id="main-col"] containing the response body
//
// The page also includes many control-only nodes for citations, copy buttons,
// sidebars and warnings, so those are stripped before Markdown conversion.

function googleSearchProcessTable(table) {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const result = [];
  rows.forEach((row, i) => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    const texts = cells.map(c => c.textContent.trim().replace(/\|/g, '\\|'));
    result.push('| ' + texts.join(' | ') + ' |');
    if (i === 0) {
      result.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    }
  });
  return result.join('\n') + '\n\n';
}

function googleSearchInline(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  const children = () => Array.from(node.childNodes).map(googleSearchInline).join('');

  switch (tag) {
    case 'b':
    case 'strong':
      return `**${children()}**`;
    case 'i':
    case 'em':
      return `*${children()}*`;
    case 'del':
    case 's':
      return `~~${children()}~~`;
    case 'code':
      return `\`${children()}\``;
    case 'a':
      return `[${children()}](${node.href})`;
    case 'br':
      return '\n';
    case 'p':
      return children();
    case 'button':
    case 'svg':
      return '';
    default:
      return children();
  }
}

function googleSearchRenderList(listNode, depth) {
  const indent = '\t'.repeat(depth);
  const isOrdered = listNode.tagName.toLowerCase() === 'ol';
  const items = Array.from(listNode.children).filter(
    el => el.tagName.toLowerCase() === 'li'
  );

  return items.map((li, idx) => {
    const bullet = isOrdered ? `${idx + 1}. ` : '- ';
    let inlineText = '';
    const subListLines = [];

    for (const child of li.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        inlineText += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childTag = child.tagName.toLowerCase();
        if (childTag === 'ul' || childTag === 'ol') {
          subListLines.push(googleSearchRenderList(child, depth + 1));
        } else {
          inlineText += googleSearchInline(child);
        }
      }
    }

    const mainLine = `${indent}${bullet}${inlineText.trim()}`;
    return subListLines.length > 0
      ? mainLine + '\n' + subListLines.join('\n')
      : mainLine;
  }).join('\n');
}

function googleSearchElementToMarkdown(element) {
  if (!element) return '';

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const children = () =>
      Array.from(node.childNodes).map(processNode).join('');

    switch (tag) {
      case 'p':
        return children() + '\n\n';
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return `**${children()}**`;
      case 'em':
      case 'i':
        return `*${children()}*`;
      case 'del':
      case 's':
        return `~~${children()}~~`;
      case 'code':
        if (node.closest('pre')) return children();
        return `\`${children()}\``;
      case 'pre': {
        const codeEl = node.querySelector('code');
        const codeText = (codeEl ? codeEl.textContent : node.textContent).trimEnd();
        return `\n\`\`\`\n${codeText}\n\`\`\`\n`;
      }
      case 'h1': return `# ${children()}\n\n`;
      case 'h2': return `## ${children()}\n\n`;
      case 'h3': return `### ${children()}\n\n`;
      case 'h4': return `#### ${children()}\n\n`;
      case 'h5': return `##### ${children()}\n\n`;
      case 'h6': return `###### ${children()}\n\n`;
      case 'ul':
      case 'ol':
        return googleSearchRenderList(node, 0) + '\n\n';
      case 'li':
        return children();
      case 'blockquote': {
        const inner = children().trim();
        return inner
          .split('\n')
          .map(line => (line.trim() ? `> ${line}` : '>'))
          .join('\n') + '\n\n';
      }
      case 'a':
        return `[${children()}](${node.href})`;
      case 'img':
        return `![${node.alt || ''}](${node.src})`;
      case 'hr':
        return '\n---\n\n';
      case 'table':
        return googleSearchProcessTable(node);
      case 'button':
      case 'svg':
        return '';
      default:
        return children();
    }
  }

  return processNode(element)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanupGoogleSearchAiResponse(root) {
  const clone = root.cloneNode(true);

  clone.querySelectorAll([
    'button',
    'svg',
    '[role="button"]',
    '[role="dialog"]',
    '[role="alert"]',
    '[aria-live="assertive"]',
    '[data-container-id="rhs-col"]',
    '[hidden]',
    '[aria-hidden="true"]'
  ].join(', ')).forEach(el => el.remove());

  clone.querySelectorAll('[style]').forEach(el => {
    const style = (el.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
    if (style.includes('display:none') || style.includes('visibility:hidden')) {
      el.remove();
    }
  });

  // Drop wrapper nodes left behind after removing action UI / corroboration controls.
  Array.from(clone.querySelectorAll('*')).reverse().forEach(el => {
    const hasMeaningfulChild = Array.from(el.children).some(child => {
      const tag = child.tagName.toLowerCase();
      return !['button', 'svg'].includes(tag);
    });
    const text = el.textContent.replace(/\u00a0/g, ' ').trim();
    if (!hasMeaningfulChild && text === '') {
      el.remove();
    }
  });

  return clone;
}

function convertGoogleSearchUserMessage(element) {
  const heading = element.querySelector('[role="heading"]');
  if (!heading) return '';

  const clone = heading.cloneNode(true);
  clone.querySelectorAll('.iMqumd, button, svg').forEach(el => el.remove());
  const text = clone.textContent.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  return (
    `<div class="you-bubble">\n` +
    `  <div class="bubble-content">\n` +
    `${text}\n` +
    `  </div>\n` +
    `</div>`
  );
}

function convertGoogleSearchAiTurn(element) {
  const mainCol = element.querySelector('[data-container-id="main-col"]');
  if (!mainCol) return '';

  const cleaned = cleanupGoogleSearchAiResponse(mainCol);
  return googleSearchElementToMarkdown(cleaned);
}

function getMessageElements() {
  return Array.from(
    document.querySelectorAll(
      'div.ilZyRc.R7mRQb, div.CKgc1d[data-scope-id="turn"]'
    )
  ).filter(el => {
    if (el.matches('div.CKgc1d[data-scope-id="turn"]')) {
      return Boolean(el.querySelector('[data-container-id="main-col"]'));
    }
    return Boolean(el.querySelector('[role="heading"]'));
  });
}

function convertMessagesToMarkdown(elements) {
  return elements
    .map(el => {
      if (el.matches('div.CKgc1d[data-scope-id="turn"]')) {
        return convertGoogleSearchAiTurn(el);
      }
      return convertGoogleSearchUserMessage(el);
    })
    .filter(text => text.trim() !== '')
    .join('\n\n');
}
