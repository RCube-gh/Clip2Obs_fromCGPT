
# dump_clipboard_textfallback.py
# pip install pywin32

import win32clipboard
import win32con

def dump_html_from_clipboard(output_path="clipboard_raw.txt"):
    CF_HTML = win32clipboard.RegisterClipboardFormat("HTML Format")

    win32clipboard.OpenClipboard()
    try:
        if win32clipboard.IsClipboardFormatAvailable(CF_HTML):
            raw = win32clipboard.GetClipboardData(CF_HTML)
            if isinstance(raw, bytes):
                html = raw.decode("utf-8", errors="replace")
            else:
                html = raw
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(html)
            print(f"✅ HTML clipboard content saved to: {output_path}")
        else:
            print("❌ No HTML format found on clipboard.")
    finally:
        win32clipboard.CloseClipboard()


def main():
    dump_html_from_clipboard()

if __name__ == "__main__":
    main()
