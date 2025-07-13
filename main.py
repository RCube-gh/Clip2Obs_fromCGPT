
# convert_chat_clipboard_v4.py
# pip install beautifulsoup4 html2text pywin32

import win32clipboard
import win32con
from bs4 import BeautifulSoup
import html2text
import re
import sys

OUTPUT_FILE = "converted_chat.md"
CF_HTML = win32clipboard.RegisterClipboardFormat("HTML Format")

def get_html() -> str | None:
    """Return raw HTML (string) from clipboard or None."""
    win32clipboard.OpenClipboard()
    try:
        if win32clipboard.IsClipboardFormatAvailable(CF_HTML):
            data = win32clipboard.GetClipboardData(CF_HTML)
            return data.decode("utf-8", "ignore") if isinstance(data, bytes) else data
        elif win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
            return win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        else:
            return None
    finally:
        win32clipboard.CloseClipboard()

def html_fragment(raw: str) -> str:
    """Extracts the fragment part of clipboard HTML."""
    m = re.search(r"<!--StartFragment-->(.*?)<!--EndFragment-->", raw, re.S)
    if m:
        return m.group(1)
    start = raw.find("<html")
    end   = raw.rfind("</html>") + 7
    return raw[start:end] if start != -1 else raw



def cleanup_markdown(md: str) -> str:
    """Clean up markdown: remove blank lines in lists, and add blank line after quote blocks."""
    lines = md.splitlines()
    new_lines = []
    prev_was_list = False

    for i, line in enumerate(lines):
        is_list = bool(re.match(r"\s*([-*]|\d+\.)\s", line))
        is_quote = line.strip().startswith(">")

        if line.strip() == "" and prev_was_list:
            continue  # skip blank line between list items

        new_lines.append(line)
        prev_was_list = is_list

        # ↓Add a blank line if the next line after the quote is a non-quote or the last line
        if is_quote:
            next_line = lines[i + 1] if i + 1 < len(lines) else ""
            if not next_line.strip().startswith(">"):
                new_lines.append("")  # insert blank line

    return "\n".join(new_lines)


def insert_codefences(soup: BeautifulSoup, placeholders: dict) -> None:
    """Replace <pre><code> blocks with @@CODE{n}@@ placeholders and store Markdown strings in `placeholders`."""
    count = 0
    for pre in soup.find_all("pre"):
        if pre.find_parent("div", attrs={"data-message-author-role": "user"}):
            continue
        code = pre.find("code")
        if not code:
            continue

        lang_class = next((cls for cls in code.get("class", []) if cls.startswith("language-")), "")
        lang = lang_class.replace("language-", "")

        raw_html = code.decode_contents()
        raw_html = raw_html.replace("<br>", "\n")
        raw_html = re.sub(r"</?span[^>]*>", "", raw_html)
        raw_html = re.sub(r"&nbsp;", " ", raw_html)
        raw_html = re.sub(r"&lt;", "<", raw_html)
        raw_html = re.sub(r"&gt;", ">", raw_html)
        raw_html = re.sub(r"&amp;", "&", raw_html)

        #Measures against line breaks Delete line breaks before and after symbols
        raw_html = re.sub(r"\n(?=[()\[\]{}\"\'.,;:+\-*/%<>=])", "", raw_html)
        placeholder = f"@@CODE{count}@@"
        fenced_block = f"\n```{lang}\n{raw_html.strip()}\n```\n"
        placeholders[placeholder] = fenced_block
        pre.replace_with(placeholder)
        count += 1

       



def md_from_chat(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    placeholders = {}
    insert_codefences(soup, placeholders)

    h2t = html2text.HTML2Text()
    h2t.body_width = 0
    h2t.unicode_snob = True
    h2t.single_line_break = True
    h2t.code_style = 'fenced'

    divs = soup.select("div[data-message-author-role]")
    out = []

    if not divs:
        md = h2t.handle(str(soup)).strip()
        for key, val in placeholders.items():
            md = md.replace(key, val)
        return cleanup_markdown(md)

    for div in divs:
        role = div["data-message-author-role"]
        if role == "user":
            raw = div.select_one(".whitespace-pre-wrap")
            if not raw:
                continue
            text = raw.get_text("\n", strip=False)
            out.append(
                '<div class="you-bubble">\n'
                '  <div class="bubble-content">\n'
                f'{text.rstrip()}\n'
                '  </div>\n'
                '</div>'
            )
        else:
            md_div = div.select_one(".markdown")
            html_snip = str(md_div) if md_div else str(div)
            md = h2t.handle(html_snip).strip()
            for key, val in placeholders.items():
                md = md.replace(key, val)
            out.append(md)

    markdown = "\n\n".join(out)
    return cleanup_markdown(markdown)


def set_clipboard(text: str):
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
    finally:
        win32clipboard.CloseClipboard()


def main():
    raw = get_html()
    if not raw:
        sys.exit("❌ No HTML or Unicode text found on clipboard.")

    frag = html_fragment(raw)
    markdown_output = md_from_chat(frag)
    markdown_output='\n'+markdown_output # add a blank line at the beginning

    if not markdown_output.strip():
        sys.exit("❌ Couldn’t extract any usable Markdown.")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(markdown_output)
    print(f"✅ Markdown saved to: {OUTPUT_FILE}")

    set_clipboard(markdown_output)
    print("✅ Markdown copied to clipboard. Paste directly into Obsidian!")

if __name__ == "__main__":
    main()
