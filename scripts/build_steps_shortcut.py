#!/usr/bin/env python3
"""PUTTERS歩数ショートカットを生成して署名する。

  python3 scripts/build_steps_shortcut.py

出力: public/shortcuts/putters-steps.shortcut（署名済み）

中身は4アクション:
  1. ヘルスケアサンプルを検索（歩数・過去7日・日ごとに集計）
  2. 名前を尋ねる（初回のみ。以降はショートカット内に保存されない=毎回聞く代わりに
     アプリ側から名前をURLで渡せないため、ここで一度だけ入力してもらう）
  3. URLの内容を取得（GASへ送信）
  4. アプリを開く

アクションIDは松本さんのiPhoneで実際に作ったショートカットから採取した実物:
  is.workflow.actions.filter.health.quantity
"""
import plistlib
import subprocess
import sys
import uuid
from pathlib import Path

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec')
APP_URL = 'https://liff-app-weld.vercel.app/'
SHORTCUT_NAME = 'PUTTERS歩数'

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / 'public' / 'shortcuts'


def uid():
    return str(uuid.uuid4()).upper()


def var(action_uuid, name):
    """他アクションの出力を参照するトークン。"""
    return {
        'Value': {'OutputUUID': action_uuid, 'OutputName': name, 'Type': 'ActionOutput'},
        'WFSerializationType': 'WFTextTokenAttachment',
    }


def text_with_vars(template, attachments):
    """'歩数は￼' のような、変数を埋め込んだテキスト。

    attachments = {文字位置: トークン}
    """
    return {
        'Value': {
            'string': template,
            'attachmentsByRange': {f'{{{pos}, 1}}': tok for pos, tok in attachments.items()},
        },
        'WFSerializationType': 'WFTextTokenString',
    }


def build():
    health_uuid, name_uuid = uid(), uid()

    actions = [
        # 1. 歩数を過去7日ぶん、日ごとに取得
        {
            'WFWorkflowActionIdentifier': 'is.workflow.actions.filter.health.quantity',
            'WFWorkflowActionParameters': {
                'UUID': health_uuid,
                'WFHKSampleFilteringUnit': 'count',
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
                'WFHKSampleClassGrouping': 'Day',            # 日ごとにまとめる
            },
        },
        # 2. 名前（お客さんが1回だけ入力）
        {
            'WFWorkflowActionIdentifier': 'is.workflow.actions.ask',
            'WFWorkflowActionParameters': {
                'UUID': name_uuid,
                'WFAskActionPrompt': 'お名前は？（PUTTERSに登録している名前）',
                'WFInputType': 'Text',
            },
        },
        # 3. GASへ送信
        {
            'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
            'WFWorkflowActionParameters': {
                'WFHTTPMethod': 'GET',
                'ShowHeaders': False,
                'WFURL': text_with_vars(
                    f'{GAS_URL}?action=saveStepsBulk&name=￼&days=￼',
                    {len(GAS_URL) + len('?action=saveStepsBulk&name='): var(name_uuid, '入力を要求'),
                     len(GAS_URL) + len('?action=saveStepsBulk&name=￼&days='): var(health_uuid, 'ヘルスケアサンプル')},
                ),
            },
        },
        # 4. アプリに戻る
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
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    unsigned = OUT_DIR / '_unsigned.shortcut'
    signed = OUT_DIR / 'putters-steps.shortcut'

    with unsigned.open('wb') as f:
        plistlib.dump(build(), f)

    r = subprocess.run(
        ['shortcuts', 'sign', '--mode', 'anyone', '--input', str(unsigned), '--output', str(signed)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print('署名に失敗:', r.stderr, file=sys.stderr)
        return 1

    unsigned.unlink()
    print(f'できました: {signed} ({signed.stat().st_size:,} bytes)')
    print(f'ショートカット名は「{SHORTCUT_NAME}」にしてもらう必要があります')
    return 0


if __name__ == '__main__':
    sys.exit(main())
