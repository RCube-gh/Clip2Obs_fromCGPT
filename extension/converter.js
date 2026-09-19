// converter.js — HTML→Markdown 変換ロジック
// main.py の変換ロジックをブラウザ用 JS に移植

/**
 * コードテキスト先頭の ChatGPT UI テキスト（言語名・Run・Copy 等）を除去する
 * 言語クラスがない場合は先頭行から言語名を自動検出して返す
 * @param {string} text
 * @param {string} knownLang  すでにクラスから取得した言語名（なければ空文字）
 * @returns {{ text: string, detectedLang: string }}
 */
function stripUILines(text, knownLang) {
  // ChatGPT の UI ボタンラベルとして現れる既知の文字列
  const knownUI = new Set(['run', 'copy code', 'copy', 'edit', 'copied', 'copy to clipboard']);
  const lines = text.split('\n');
  let detectedLang = '';

  while (lines.length > 0) {
    const raw = lines[0].trim();
    const lower = raw.toLowerCase();

    if (!raw) {
      // 空行は除去
      lines.shift();
    } else if (knownUI.has(lower)) {
      // 既知 UI テキストは除去
      lines.shift();
    } else if (knownLang && lower === knownLang.toLowerCase()) {
      // 言語名と一致する行は除去（例: "Python" → すでに lang あり）
      lines.shift();
    } else if (!knownLang && !detectedLang && /^[a-zA-Z][a-zA-Z0-9+#\-.]*$/.test(raw) && raw.length < 24) {
      // 言語名っぽい短い英字の行 → 言語として採用して除去
      detectedLang = lower;
      lines.shift();
    } else {
      break;
    }
  }

  return { text: lines.join('\n'), detectedLang };
}

/**
 * ChatGPT 新 UI の CodeMirror コンテンツ (`.cm-content`) から
 * コードテキストを再構築する。
 * 構造: <span>(コードトークン)</span> と <br>(改行) が直接の子要素として並んでいる
 * @param {Element} cmContent
 * @returns {string}
 */
function extractCmContent(cmContent) {
  let result = '';
  for (const child of cmContent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.tagName.toLowerCase() === 'br') {
        result += '\n';
      } else {
        // <span> 等のトークン要素: テキストをそのまま取得
        result += child.textContent;
      }
    }
  }
  return result;
}

/**
 * ChatGPT appends this tracking parameter to outgoing links. Remove only that
 * parameter so URLs with meaningful query strings and fragments stay intact.
 * @param {string} href
 * @returns {string}
 */
function stripChatGptTrackingParam(href) {
  try {
    const url = new URL(href);
    if (url.searchParams.get('utm_source') === 'chatgpt.com') {
      url.searchParams.delete('utm_source');
    }
    return url.href;
  } catch {
    return href;
  }
}

/**
 * DOM要素を再帰的にMarkdownに変換する
 * @param {Element} element
 * @returns {string}
 */
function elementToMarkdown(element) {
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

      case 'code': {
        // pre > code はコードブロック側で処理するのでスキップ
        if (node.closest('pre')) return children();
        return `\`${children()}\``;
      }

      case 'pre': {
        // ── ChatGPT 新 UI: CodeMirror ベースの構造 ──────────────────────
        // <code> 要素は存在しない。言語名は sticky ヘッダー内、
        // コードは .cm-content の <span>/<br> で構成される。
        const cmContent = node.querySelector('.cm-content');
        if (cmContent) {
          // 言語名: sticky ヘッダーをクローンして button・SVG を除去 → 残るのが言語名テキスト
          let lang = '';
          const stickyHeader = node.querySelector('.sticky');
          if (stickyHeader) {
            const headerClone = stickyHeader.cloneNode(true);
            headerClone.querySelectorAll('button, svg').forEach(el => el.remove());
            lang = headerClone.textContent.trim().toLowerCase();
          }
          const codeText = extractCmContent(cmContent);
          return `\n\`\`\`${lang}\n${codeText.trimEnd()}\n\`\`\`\n`;
        }

        // ── フォールバック: <code> 要素がある場合（他サービス等）──────────
        const codeEl = node.querySelector('code');
        if (codeEl) {
          const langClass =
            Array.from(codeEl.classList).find(c =>
              c.startsWith('language-')
            ) || '';
          let lang = langClass.replace('language-', '');
          const clone = codeEl.cloneNode(true);
          clone.querySelectorAll('button, [role="button"], svg').forEach(el => el.remove());
          const rawText = clone.innerText ?? clone.textContent;
          const { text: codeText, detectedLang } = stripUILines(rawText, lang);
          if (!lang && detectedLang) lang = detectedLang;
          return `\n\`\`\`${lang}\n${codeText.trimEnd()}\n\`\`\`\n`;
        }

        // ── 最終フォールバック ────────────────────────────────────────────
        return `\n\`\`\`\n${(node.innerText ?? node.textContent).trimEnd()}\n\`\`\`\n`;
      }

      case 'h1': return `# ${children()}\n\n`;
      case 'h2': return `## ${children()}\n\n`;
      case 'h3': return `### ${children()}\n\n`;
      case 'h4': return `#### ${children()}\n\n`;
      case 'h5': return `##### ${children()}\n\n`;
      case 'h6': return `###### ${children()}\n\n`;

      case 'ul':
        return (
          Array.from(node.children)
            .map(li => `- ${processNode(li).trim()}`)
            .join('\n') + '\n\n'
        );

      case 'ol':
        return (
          Array.from(node.children)
            .map((li, i) => `${i + 1}. ${processNode(li).trim()}`)
            .join('\n') + '\n\n'
        );

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
        return `[${children()}](${stripChatGptTrackingParam(node.href)})`;

      case 'img':
        return `![${node.alt || ''}](${node.src})`;

      case 'hr':
        return '\n---\n\n';

      case 'table':
        return processTable(node);

      // 無視するタグ（ボタン類など）
      case 'button':
      case 'svg':
        return '';

      default:
        return children();
    }
  }

  function processTable(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return '';

    const result = [];
    rows.forEach((row, i) => {
      const cells = Array.from(row.querySelectorAll('th, td'));
      const texts = cells.map(c =>
        c.textContent.trim().replace(/\|/g, '\\|')
      );
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

/**
 * メッセージ div 1つを Markdown 文字列に変換する
 * @param {Element} messageDiv  data-message-author-role を持つ要素
 * @returns {string}
 */
function convertMessageToMarkdown(messageDiv) {
  const role = messageDiv.getAttribute('data-message-author-role');

  if (role === 'user') {
    // ユーザーのメッセージ → you-bubble タグで囲む
    const textEl = messageDiv.querySelector('.whitespace-pre-wrap');
    const text = (textEl ? textEl.innerText : messageDiv.innerText).trim();
    return (
      // convertMessagesToMarkdown inserts two newlines between turns. The
      // extra newline here gives user bubbles two blank lines above and below.
      `\n<div class="you-bubble">\n` +
      `  <div class="bubble-content">\n` +
      `${text}\n` +
      `  </div>\n` +
      `</div>\n`
    );
  } else {
    // AI のメッセージ → Markdown に変換
    const mdDiv = messageDiv.querySelector('.markdown') || messageDiv;
    return elementToMarkdown(mdDiv);
  }
}

/**
 * ChatGPT のメッセージ要素を収集して返す
 * @returns {Element[]}
 */
function getMessageElements() {
  return Array.from(
    document.querySelectorAll('[data-message-author-role]')
  );
}

/**
 * 複数のメッセージ div を順番通りに Markdown に変換して結合する
 * @param {Element[]} messageDivs
 * @returns {string}
 */
function convertMessagesToMarkdown(messageDivs) {
  return messageDivs
    .map(div => convertMessageToMarkdown(div))
    .join('\n\n');
}
