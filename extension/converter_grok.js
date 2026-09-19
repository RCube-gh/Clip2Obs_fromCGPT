// converter_grok.js — Grok 専用 HTML→Markdown 変換ロジック
//
// DOM 構造サマリー:
//   各メッセージ : <div id="response-XXXX" class="... items-end|items-start ...">
//     items-end   → ユーザーメッセージ（右寄せ）
//     items-start → AI 応答（左寄せ）
//   本文コンテナ : .response-content-markdown.markdown
//     通常要素   : <p>, <h1>〜<h6>, <ul>, <ol>, <blockquote>, <strong>, <em> 等
//     コードブロック: <div class="not-prose">
//                       └── <div data-testid="code-block">
//                             ├── <span class="font-mono ...">Python</span>  ← 言語名
//                             └── <pre class="shiki ..."><code>
//                                   <span class="line"><span style="color:...">...</span></span>
//                                 </code></pre>

/**
 * Grok の [data-testid="code-block"] からコードブロックのMarkdownを生成
 * @param {Element} codeBlockDiv
 * @returns {string}
 */
function grokCodeBlockToMarkdown(codeBlockDiv) {
  // 言語名: ヘッダー行内の font-mono クラスを持つ <span>
  const langSpan = codeBlockDiv.querySelector('span.font-mono, span[class*="font-mono"]');
  const lang = langSpan ? langSpan.textContent.trim().toLowerCase() : '';

  // コード本体: <span class="line"> のテキストを改行で結合
  // Shiki は各行を <span class="line"> でラップし、トークンに <span style="color:..."> をつける
  const codeEl = codeBlockDiv.querySelector('pre code');
  let codeText = '';
  if (codeEl) {
    const lines = Array.from(codeEl.querySelectorAll('span.line'));
    if (lines.length > 0) {
      codeText = lines.map(l => l.textContent).join('\n').trimEnd();
    } else {
      // span.line がない場合のフォールバック
      codeText = codeEl.textContent.trimEnd();
    }
  }

  return `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`;
}

/**
 * DOM要素を再帰的にMarkdownに変換する (Grok 版)
 * Grok は Gemini と同様に標準 HTML を使うが、
 * コードブロックは div[data-testid="code-block"] 内の Shiki 構造になる。
 * @param {Element} element
 * @returns {string}
 */
function elementToMarkdownGrok(element) {
  if (!element) return '';

  /**
   * リストアイテム内のインライン要素を処理する（<p>で\n\nをつけない）
   */
  function processNodeInline(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const ic = () => Array.from(node.childNodes).map(processNodeInline).join('');
    switch (tag) {
      case 'b': case 'strong': return `**${ic()}**`;
      case 'i': case 'em':    return `*${ic()}*`;
      case 'del': case 's':   return `~~${ic()}~~`;
      case 'code':            return `\`${ic()}\``;
      case 'a':               return `[${ic()}](${node.href})`;
      case 'br':              return '\n';
      case 'p':               return ic(); // \n\n なし
      case 'button': case 'svg': return '';
      default:                return ic();
    }
  }

  /**
   * ul/ol を深さを意識して再帰的に Markdown に変換する
   * @param {Element} listNode  <ul> or <ol>
   * @param {number}  depth     ネスト深さ（0 始まり）
   * @returns {string}
   */
  function renderListNode(listNode, depth) {
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
            subListLines.push(renderListNode(child, depth + 1));
          } else {
            inlineText += processNodeInline(child);
          }
        }
      }

      const mainLine = `${indent}${bullet}${inlineText.trim()}`;
      if (subListLines.length > 0) {
        return mainLine + '\n' + subListLines.join('\n');
      }
      return mainLine;
    }).join('\n');
  }

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const children = () =>
      Array.from(node.childNodes).map(processNode).join('');

    // ── Grok 固有: コードブロック ────────────────────────────────────
    // このノード自身が [data-testid="code-block"] の場合のみ変換
    // (querySelector で子孫を検索すると p 等が丸ごと無視されるバグになる)
    if (tag === 'div') {
      if (node.dataset && node.dataset.testid === 'code-block') {
        return grokCodeBlockToMarkdown(node);
      }
      // 通常の div (not-prose ラッパー等) → 中身を再帰処理
      return children();
    }

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

      case 'code': {
        if (node.closest('pre')) return children();
        return `\`${children()}\``;
      }

      case 'pre': {
        // Shiki の pre は div[data-testid="code-block"] 内で処理されるが
        // 直接来た場合のフォールバック
        const codeEl = node.querySelector('code');
        if (codeEl) {
          const lines = Array.from(codeEl.querySelectorAll('span.line'));
          const codeText = lines.length > 0
            ? lines.map(l => l.textContent).join('\n').trimEnd()
            : codeEl.textContent.trimEnd();
          return `\n\`\`\`\n${codeText}\n\`\`\`\n`;
        }
        return `\n\`\`\`\n${node.textContent.trimEnd()}\n\`\`\`\n`;
      }

      case 'h1': return `# ${children()}\n\n`;
      case 'h2': return `## ${children()}\n\n`;
      case 'h3': return `### ${children()}\n\n`;
      case 'h4': return `#### ${children()}\n\n`;
      case 'h5': return `##### ${children()}\n\n`;
      case 'h6': return `###### ${children()}\n\n`;

      case 'ul':
      case 'ol':
        return renderListNode(node, 0) + '\n\n';

      case 'li':
        return children();

      case 'blockquote': {
        const inner = children().trim();
        return (
          inner
            .split('\n')
            .map(l => (l.trim() ? `> ${l}` : '>'))
            .join('\n') + '\n\n'
        );
      }

      case 'a':
        return `[${children()}](${node.href})`;

      case 'img':
        return `![${node.alt || ''}](${node.src})`;

      case 'hr':
        return '\n---\n\n';

      case 'table':
        return processTableGrok(node);

      // 無視するタグ
      case 'button':
      case 'svg':
      case 'section': // inline-media-container 等
        return '';

      default:
        return children();
    }
  }

  function processTableGrok(table) {
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

  return processNode(element)
    .replace(/\n{3,}/g, '\n\n') // 3行以上の空行を2行に
    .trim();
}

// ─────────────────────────────────────────────────────────────
// 公開 API (content.js から呼び出す)
// ─────────────────────────────────────────────────────────────

/**
 * Grok のメッセージ要素を収集して返す
 * id="response-*" かつ items-end/items-start を持つ div
 * @returns {Element[]}
 */
function getMessageElements() {
  return Array.from(
    document.querySelectorAll('div[id^="response-"]')
  ).filter(el =>
    el.classList.contains('items-end') ||
    el.classList.contains('items-start')
  );
}

/**
 * 複数のメッセージ要素を Markdown に変換して結合する
 * @param {Element[]} elements
 * @returns {string}
 */
function convertMessagesToMarkdown(elements) {
  return elements
    .map(el => {
      const isUser = el.classList.contains('items-end');

      // 本文コンテナ
      const mdEl = el.querySelector('.response-content-markdown');
      if (!mdEl) return '';

      if (isUser) {
        // ── ユーザーメッセージ ──────────────────────────────────────
        // シンプルなテキスト（<p> のみが多い）
        const clone = mdEl.cloneNode(true);
        // ボタン類を除去
        clone.querySelectorAll('button, svg, section').forEach(e => e.remove());
        const text = clone.textContent.trim();
        return (
          `<div class="you-bubble">\n` +
          `  <div class="bubble-content">\n` +
          `${text}\n` +
          `  </div>\n` +
          `</div>`
        );
      } else {
        // ── AI 応答 ────────────────────────────────────────────────
        return elementToMarkdownGrok(mdEl);
      }
    })
    .filter(s => s.trim() !== '')
    .join('\n\n');
}
