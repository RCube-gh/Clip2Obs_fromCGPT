// converter_gemini.js — Gemini 専用 HTML→Markdown 変換ロジック
//
// DOM 構造サマリー:
//   ユーザーメッセージ : <user-query>
//     └─ .query-text-line  (テキスト)
//   AI 応答             : <model-response>
//     └─ .markdown (標準 HTML: <p>, <h2>, <ul>, etc.)
//        └─ <response-element><code-block>  (コードブロック)
//              ├─ div.code-block-decoration span:first-of-type  → 言語名
//              └─ code[data-test-id="code-content"]             → コード本体

/**
 * Gemini の <response-element><code-block> からコードブロックの
 * Markdown 文字列を生成する
 * @param {Element} responseEl  <response-element>
 * @returns {string}
 */
function geminiCodeBlockToMarkdown(responseEl) {
  const codeBlock = responseEl.querySelector('.code-block');
  if (!codeBlock) return '';

  // 言語名: ヘッダー内の最初の <span>
  const langSpan = codeBlock.querySelector('.code-block-decoration span:first-of-type');
  const lang = langSpan ? langSpan.textContent.trim().toLowerCase() : '';

  // コード本体: data-test-id="code-content" の <code> の textContent
  // (hljs-* クラスの <span> は textContent で自動的に剥がれる)
  const codeEl = codeBlock.querySelector('code[data-test-id="code-content"]');
  const codeText = codeEl ? codeEl.textContent.trimEnd() : '';

  return `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`;
}

/**
 * DOM要素を再帰的にMarkdownに変換する (Gemini 版)
 * 基本ロジックは converter.js の elementToMarkdown と同じだが、
 * <response-element> / <code-block> のカスタム要素を追加で処理する。
 * @param {Element} element
 * @returns {string}
 */
function elementToMarkdownGemini(element) {
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
      case 'button': case 'svg': case 'mat-icon': return '';
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
            // ネストリストは再帰処理
            subListLines.push(renderListNode(child, depth + 1));
          } else {
            // p, b, code 等をインラインとして処理
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

    // ── Gemini 固有: コードブロック ──────────────────────────────────
    if (tag === 'response-element') {
      return geminiCodeBlockToMarkdown(node);
    }
    // code-block 自体が直接来ることは稀だが念のため
    if (tag === 'code-block') {
      return geminiCodeBlockToMarkdown(node);
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
        // pre > code はコードブロック側で処理するのでスキップ
        if (node.closest('pre')) return children();
        return `\`${children()}\``;
      }

      case 'pre': {
        // Gemini では通常 <response-element> でラップされるが、
        // 稀に直接 <pre><code> が来る場合のフォールバック
        const codeEl = node.querySelector('code');
        if (codeEl) {
          const lang = Array.from(codeEl.classList)
            .find(c => c.startsWith('language-'))
            ?.replace('language-', '') || '';
          return `\n\`\`\`${lang}\n${codeEl.textContent.trimEnd()}\n\`\`\`\n`;
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
        // renderListNode で深さを意識したネスト処理
        return renderListNode(node, 0) + '\n\n';

      case 'li':
        // renderListNode 内で処理されるが、直接呼ばれた場合のフォールバック
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
        return processTableGemini(node);

      // 無視するタグ
      case 'button':
      case 'svg':
      case 'mat-icon':
        return '';

      default:
        return children();
    }
  }

  function processTableGemini(table) {
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
 * Gemini の会話要素を収集して返す
 * user-query と model-response を交互に並べた配列
 * @returns {Element[]}
 */
function getMessageElements() {
  return Array.from(
    document.querySelectorAll('user-query, model-response')
  );
}

/**
 * 複数の会話要素を順番通りに Markdown へ変換して結合する
 * @param {Element[]} elements
 * @returns {string}
 */
function convertMessagesToMarkdown(elements) {
  return elements
    .map(el => {
      const tag = el.tagName.toLowerCase();

      if (tag === 'user-query') {
        // ── ユーザーメッセージ ────────────────────────────────────────
        // テキスト: .query-text-line 内 (複数行ある場合も考慮)
        const queryText = el.querySelector('.query-text');
        if (!queryText) return '';

        // "You said" 等の非表示テキストを除去してから取得
        const clone = queryText.cloneNode(true);
        clone.querySelectorAll('.cdk-visually-hidden').forEach(e => e.remove());
        const text = clone.textContent.trim();

        return (
          `<div class="you-bubble">\n` +
          `  <div class="bubble-content">\n` +
          `${text}\n` +
          `  </div>\n` +
          `</div>`
        );
      } else {
        // ── AI 応答 ──────────────────────────────────────────────────
        // .markdown クラスを持つ div が本文コンテナ
        const mdEl =
          el.querySelector('.markdown') ||
          el.querySelector('[class*="markdown"]') ||
          el;
        return elementToMarkdownGemini(mdEl);
      }
    })
    .filter(s => s.trim() !== '')
    .join('\n\n');
}
