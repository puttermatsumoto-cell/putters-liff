#!/usr/bin/env python3
"""
YouTube動画公開時の一括反映スクリプト
PUTTERSアプリ + メモリ + デプロイを1コマンドで完了する

Usage:
  python3 scripts/publish_video.py <url> <number> <slug> <title> [desc]

Example:
  python3 scripts/publish_video.py \\
    https://youtu.be/p6Z4qYLS8kw 04 balanceball \\
    "バランスボールクランチは骨盤10%、胸椎90%" \\
    "骨盤後傾を覚えた次のステップ。意識の90%は胸椎を動かすことに使う。"

更新箇所:
  1. liff-app/public/textbook.html (新カード追加)
  2. liff-app/public/index.html (LATEST_VIDEO定数)
  3. liff-app/public/index.html (TOTAL_VIDEOS +1)
  4. memory/youtube_strategy.md (公開リストに追加)
  5. memory/youtube_video_order.md (公開済みテーブルに追加・短期セクションから削除)
  6. git add / commit / push (liff-app)
"""

import re
import sys
import subprocess
from pathlib import Path

LIFF_APP = Path("/home/poritan/secretary/liff-app")
MEMORY = Path("/home/poritan/.claude/projects/-home-poritan-secretary/memory")

NUM_SYMBOLS = {
    "01": "①", "02": "②", "03": "③", "04": "④", "05": "⑤",
    "06": "⑥", "07": "⑦", "08": "⑧", "09": "⑨", "10": "⑩",
    "11": "⑪", "12": "⑫", "13": "⑬", "14": "⑭", "15": "⑮",
    "16": "⑯", "17": "⑰", "18": "⑱", "19": "⑲", "20": "⑳",
}


def extract_video_id(url: str) -> str:
    m = re.match(r"https?://youtu\.be/([^?&]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"v=([^&]+)", url)
    if m:
        return m.group(1)
    raise ValueError(f"Invalid YouTube URL: {url}")


def update_textbook(slug, number, title, desc, url):
    path = LIFF_APP / "public" / "textbook.html"
    content = path.read_text(encoding="utf-8")

    if f'id="card-{slug}"' in content:
        print(f"⏭  textbook.html: card-{slug} は既に存在")
        return

    symbol = NUM_SYMBOLS.get(number, f"({number})")
    new_card = f'''  <div class="card" id="card-{slug}">
    <div class="num">{symbol}</div>
    <div style="flex:1; display:flex; flex-direction:column;">
      <div class="card-title"><a href="{url}" target="_blank">{title}</a></div>
      <div class="card-desc">{desc}</div>
      <div class="badge" id="badge-{slug}" style="display:none;">✅ 履修済み</div>
    </div>
    <button class="check-btn" id="check-{slug}" onclick="toggleWatch('{slug}')">✓</button>
  </div>

'''

    marker = '  <div class="message-card">'
    if marker not in content:
        raise ValueError("Could not find message-card marker in textbook.html")

    content = content.replace(marker, new_card + marker, 1)
    path.write_text(content, encoding="utf-8")
    print(f"✅ textbook.html: {symbol} {title}")


def update_index(slug, number, title, video_id):
    path = LIFF_APP / "public" / "index.html"
    content = path.read_text(encoding="utf-8")

    new_latest = f"""const LATEST_VIDEO = {{
        slug: '{slug}',
        id: '{video_id}',
        number: '#{number}',
        title: '{title}'
      }};"""
    content, n = re.subn(
        r"const LATEST_VIDEO = \{[^}]+\};",
        new_latest,
        content,
    )
    if n != 1:
        raise ValueError(f"Could not find LATEST_VIDEO in index.html (matched {n} times)")

    def inc(m):
        return f"const TOTAL_VIDEOS = {int(m.group(1)) + 1};"

    content, n = re.subn(r"const TOTAL_VIDEOS = (\d+);", inc, content)
    if n != 1:
        raise ValueError(f"Could not find TOTAL_VIDEOS in index.html (matched {n} times)")

    path.write_text(content, encoding="utf-8")
    print(f"✅ index.html: LATEST_VIDEO=#{number}, TOTAL_VIDEOS +1")


def update_strategy(title, url):
    path = MEMORY / "youtube_strategy.md"
    if not path.exists():
        print(f"⚠️  {path} なし、スキップ")
        return

    content = path.read_text(encoding="utf-8")

    if url in content:
        print(f"⏭  youtube_strategy.md: {url} は既に登録済み")
        return

    lines = content.split("\n")
    last_index = -1
    last_num = 0
    for i, line in enumerate(lines):
        m = re.match(r"^(\d+)\. .* https://youtu\.be/", line)
        if m:
            last_index = i
            last_num = int(m.group(1))

    if last_index != -1:
        lines.insert(last_index + 1, f"{last_num + 1}. {title} {url}")
        path.write_text("\n".join(lines), encoding="utf-8")
        print(f"✅ youtube_strategy.md: {last_num + 1}本目に追加")
    else:
        print("⚠️  投稿リストの末尾を特定できず、手動確認推奨")


def update_video_order(number, title, url, center_word=None):
    path = MEMORY / "youtube_video_order.md"
    if not path.exists():
        print(f"⚠️  {path} なし、スキップ")
        return

    content = path.read_text(encoding="utf-8")
    n_str = f"#{number}"

    if url in content:
        print(f"⏭  youtube_video_order.md: {url} は既に登録済み")
        return

    # 公開済みテーブル末尾に追加
    pub_match = re.search(
        r"(## 公開済み[^\n]*\n.*?\| #\d+ \|[^\n]+\n)(\n---)",
        content,
        re.DOTALL,
    )
    if pub_match:
        new_row = f"| {n_str} | {title} | {center_word or '-'} | {url} |\n"
        content = content.replace(pub_match.group(0), pub_match.group(1) + new_row + pub_match.group(2), 1)

        # 短期テーブルの該当行を削除
        content = re.sub(
            rf"\| {re.escape(n_str)} \|[^\n]+\n",
            "",
            content,
            count=1,
        )

        path.write_text(content, encoding="utf-8")
        print(f"✅ youtube_video_order.md: 公開済みテーブルに追加")
    else:
        print("⚠️  公開済みテーブルが見つからず、手動確認推奨")


def deploy(number, title):
    msg = f"video: #{number} {title}を反映"
    cmds = [
        ["git", "-C", str(LIFF_APP), "add", "public/textbook.html", "public/index.html"],
        ["git", "-C", str(LIFF_APP), "commit", "-m", f"""{msg}

Co-Authored-By: Claude <noreply@anthropic.com>"""],
        ["git", "-C", str(LIFF_APP), "push"],
    ]
    for cmd in cmds:
        subprocess.run(cmd, check=True)
    print("✅ git push 完了 - Vercelに自動デプロイ中")


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)

    url = sys.argv[1]
    number = sys.argv[2].zfill(2)
    slug = sys.argv[3]
    title = sys.argv[4]
    desc = sys.argv[5] if len(sys.argv) > 5 else ""
    center_word = sys.argv[6] if len(sys.argv) > 6 else None

    video_id = extract_video_id(url)

    print(f"\n📺 Publishing #{number} {title}")
    print(f"   URL: {url}")
    print(f"   slug: {slug}\n")

    update_textbook(slug, number, title, desc, url)
    update_index(slug, number, title, video_id)
    update_strategy(title, url)
    update_video_order(number, title, url, center_word)
    deploy(number, title)

    print(f"\n✅ #{number} 完全反映完了")


if __name__ == "__main__":
    main()
