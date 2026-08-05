#!/usr/bin/env python3
"""PUTTERS歩数ショートカットを、お客さん1人ずつ生成して署名する。

  python3 scripts/build_steps_shortcut.py

出力: public/shortcuts/<名前>/PUTTERS歩数.shortcut（署名済み）

名前は宿題シートから取る。名前をURLに埋め込むので、お客さんは
一度も名前を打たない（追加して押すだけ）。

ファイル名がそのまま取り込み後のショートカット名になるため、
全員ぶん同じ `PUTTERS歩数.shortcut` にして人ごとのフォルダに分ける。
こうするとアプリ側は誰に対しても同じ名前で呼べる。

中身は3アクション:
  1. ヘルスケアサンプルを検索（歩数・過去7日・日ごとに集計）
  2. URLの内容を取得（GASへ送信）
  3. アプリを開く

アクションIDは松本さんのiPhoneで実際に作ったショートカットから採取した実物:
  is.workflow.actions.filter.health.quantity
"""
import json
import plistlib
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec')
APP_URL = 'https://liff-app-weld.vercel.app/'
SHORTCUT_NAME = 'PUTTERS歩数'

# 宿題シートの見出し行。人ではない
SKIP_NAMES = {'カレンダー名', ''}

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / 'public' / 'shortcuts'


def uid():
    return str(uuid.uuid4()).upper()


def fetch_names():
    with urllib.request.urlopen(f'{GAS_URL}?action=admin_homework') as r:
        rows = json.load(r)
    names = [str(row.get('name', '')).strip() for row in rows]
    return [n for n in names if n and n not in SKIP_NAMES]


def build(name):
    """1人ぶんのショートカット定義。name はURLに埋め込み済みで届く。"""
    health_uuid = uid()

    # 歩数の集計結果をそのままURLに差し込む
    url_prefix = (f'{GAS_URL}?action=saveStepsBulk'
                  f'&name={urllib.parse.quote(name)}&days=')
    url_value = {
        'Value': {
            'string': url_prefix + '￼',
            'attachmentsByRange': {
                f'{{{len(url_prefix)}, 1}}': {
                    'Value': {
                        'OutputUUID': health_uuid,
                        'OutputName': 'ヘルスケアサンプル',
                        'Type': 'ActionOutput',
                    },
                    'WFSerializationType': 'WFTextTokenAttachment',
                },
            },
        },
        'WFSerializationType': 'WFTextTokenString',
    }

    actions = [
        # 1. 歩数を過去7日ぶん、日ごとに取得
        {
            'WFWorkflowActionIdentifier': 'is.workflow.actions.filter.health.quantity',
            'WFWorkflowActionParameters': {
                'UUID': health_uuid,
                'WFHKSampleFilteringUnit': 'count',
                'WFHKSampleClassGrouping': 'Day',
                'WFContentItemFilter': {
                    'Value': {
                        'WFActionParameterFilterPrefix': 1,   # すべてが真
                        'WFActionParameterFilterTemplates': [
                            {
                                'Property': 'サンプルタイプ',
                                'Operator': 4,               # が次と等しい
                                'Values': {'SampleType': 'HKQuantityTypeIdentifierStepCount'},
                            },
                            {
                                'Property': '開始日',
                                'Operator': 1001,            # が次の過去の期間内
                                'Values': {
                                    'RelativeDateBoundary': {
                                        'Value': {'Unit': 128, 'Count': 7},
                                        'WFSerializationType': 'WFQuantityFieldValue',
                                    },
                                },
                            },
                        ],
                    },
                    'WFSerializationType': 'WFContentPredicateTableTemplate',
                },
            },
        },
        # 2. GASへ送信
        {
            'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
            'WFWorkflowActionParameters': {
                'WFHTTPMethod': 'GET',
                'ShowHeaders': False,
                'WFURL': url_value,
            },
        },
        # 3. アプリに戻る
        {
            'WFWorkflowActionIdentifier': 'is.workflow.actions.openurl',
            'WFWorkflowActionParameters': {'WFInput': APP_URL},
        },
    ]

    return {
        'WFWorkflowActions': actions,
        'WFWorkflowClientVersion': '900',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowHasOutputFallback': False,
        'WFWorkflowHasShortcutInputVariables': False,
        'WFWorkflowIcon': {
            'WFWorkflowIconGlyphNumber': 59511,
            'WFWorkflowIconStartColor': -2873601,
        },
        'WFWorkflowImportQuestions': [],
        'WFWorkflowInputContentItemClasses': [],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': ['NCWidget', 'WatchKit'],
        'WFQuickActionSurfaces': [],
    }


def main():
    names = fetch_names()
    print(f'{len(names)}人ぶん作ります')

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    made, failed = 0, []
    for name in names:
        person_dir = OUT_DIR / name
        person_dir.mkdir(parents=True, exist_ok=True)
        unsigned = person_dir / '_unsigned.shortcut'
        signed = person_dir / f'{SHORTCUT_NAME}.shortcut'

        with unsigned.open('wb') as f:
            plistlib.dump(build(name), f)

        r = subprocess.run(
            ['shortcuts', 'sign', '--mode', 'anyone',
             '--input', str(unsigned), '--output', str(signed)],
            capture_output=True, text=True,
        )
        unsigned.unlink(missing_ok=True)
        if r.returncode != 0:
            failed.append((name, r.stderr.strip()))
        else:
            made += 1

    print(f'できました: {made}人ぶん → {OUT_DIR}')
    if failed:
        print(f'失敗 {len(failed)}件:', file=sys.stderr)
        for name, err in failed:
            print(f'  {name}: {err}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
