/**
 * Preference Executors
 * P3-PREF3: スケジュール好み設定の実行
 * 
 * - preference.set: 好み設定（自然文から）
 * - preference.show: 好み表示
 * - preference.clear: 好みクリア
 */

import { usersMeApi, type SchedulePreferences, type TimeWindow } from '../../api/usersMe';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';
import { mergePreferences } from '../classifier/preference';

/**
 * 曜日番号を日本語に変換
 */
function dowToJapanese(dow: number[]): string {
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  
  // 平日チェック
  if (dow.length === 5 && [1, 2, 3, 4, 5].every(d => dow.includes(d))) {
    return '平日';
  }
  
  // 週末チェック
  if (dow.length === 2 && dow.includes(0) && dow.includes(6)) {
    return '土日';
  }
  
  // 毎日チェック
  if (dow.length === 7) {
    return '毎日';
  }
  
  return dow.map(d => dayNames[d]).join('・');
}

/**
 * TimeWindowを日本語で表現
 */
function formatTimeWindow(w: TimeWindow): string {
  const days = dowToJapanese(w.dow);
  const time = `${w.start}〜${w.end}`;
  const weight = w.weight > 0 ? '(優先)' : '(避けたい)';
  return `${days} ${time} ${weight}`;
}

/**
 * P3-PREF3: preference.set
 * 自然文から好みを設定
 */
export async function executePreferenceSet(intentResult: IntentResult): Promise<ExecutionResult> {
  const parsedPrefs = intentResult.params.parsed_prefs as {
    windows?: Array<{ dow: number[]; start: string; end: string; weight: number; label: string }>;
    avoid?: Array<{ dow: number[]; start: string; end: string; weight: number; label: string }>;
    min_notice_hours?: number;
  };
  const originalText = intentResult.params.original_text as string;

  if (!parsedPrefs) {
    return {
      success: false,
      message: '❌ 好みの設定を解析できませんでした。\n\n例: 「平日14時以降がいい」「昼は避けたい」「土日はNG」',
    };
  }

  try {
    // 既存の設定を取得
    const existingResponse = await usersMeApi.getSchedulePrefs();
    const existingPrefs = existingResponse.schedule_prefs || {};

    // マージ
    const mergedPrefs = mergePreferences(existingPrefs, parsedPrefs);

    // 保存
    const response = await usersMeApi.updateSchedulePrefs(mergedPrefs);

    if (!response.success) {
      return {
        success: false,
        message: '❌ 好みの設定の保存に失敗しました。',
      };
    }

    // 成功メッセージ
    let message = `✅ **好みを設定しました**\n\n`;
    message += `📝 入力: "${originalText}"\n\n`;

    if (parsedPrefs.windows && parsedPrefs.windows.length > 0) {
      message += `**追加した優先時間帯:**\n`;
      for (const w of parsedPrefs.windows) {
        message += `• ${formatTimeWindow(w)}\n`;
      }
      message += '\n';
    }

    if (parsedPrefs.avoid && parsedPrefs.avoid.length > 0) {
      message += `**追加した避けたい時間帯:**\n`;
      for (const a of parsedPrefs.avoid) {
        message += `• ${formatTimeWindow(a)}\n`;
      }
      message += '\n';
    }

    if (parsedPrefs.min_notice_hours) {
      message += `**最小通知時間:** ${parsedPrefs.min_notice_hours}時間前まで\n\n`;
    }

    message += `💡 ヒント: 「好み見せて」で現在の設定を確認、「好みクリア」でリセットできます。`;

    return {
      success: true,
      message,
      data: {
        kind: 'preference.set',
        payload: response.schedule_prefs,
      },
    };
  } catch (error) {
    console.error('[preference.set] Error:', error);
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P3-PREF3: preference.show
 * 現在の好み設定を表示
 */
export async function executePreferenceShow(): Promise<ExecutionResult> {
  try {
    const response = await usersMeApi.getSchedulePrefs();

    if (!response.has_prefs) {
      return {
        success: true,
        message: '📋 **スケジュール好み設定**\n\nまだ設定されていません。\n\n例: 「平日14時以降がいい」「昼は避けたい」と入力してください。',
        data: {
          kind: 'preference.show',
          payload: null,
        },
      };
    }

    const prefs = response.schedule_prefs;
    let message = '📋 **現在のスケジュール好み設定**\n\n';

    // 優先時間帯
    if (prefs.windows && prefs.windows.length > 0) {
      message += '**✅ 優先時間帯:**\n';
      for (const w of prefs.windows) {
        message += `• ${formatTimeWindow(w)}\n`;
      }
      message += '\n';
    }

    // 避けたい時間帯
    if (prefs.avoid && prefs.avoid.length > 0) {
      message += '**⛔ 避けたい時間帯:**\n';
      for (const a of prefs.avoid) {
        message += `• ${formatTimeWindow(a)}\n`;
      }
      message += '\n';
    }

    // その他の設定
    if (prefs.min_notice_hours) {
      message += `**⏰ 最小通知時間:** ${prefs.min_notice_hours}時間前まで\n`;
    }
    if (prefs.meeting_length_min) {
      message += `**📏 会議の長さ:** ${prefs.meeting_length_min}分\n`;
    }
    if (prefs.max_end_time) {
      message += `**🌙 最終終了時刻:** ${prefs.max_end_time}\n`;
    }

    // 設定がない場合
    if (!prefs.windows?.length && !prefs.avoid?.length && !prefs.min_notice_hours) {
      message += 'まだ具体的な設定がありません。\n';
    }

    message += '\n💡 ヒント: 「好みクリア」で設定をリセットできます。';

    return {
      success: true,
      message,
      data: {
        kind: 'preference.show',
        payload: prefs,
      },
    };
  } catch (error) {
    console.error('[preference.show] Error:', error);
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P3-PREF3: preference.clear
 * 好み設定をクリア
 */
export async function executePreferenceClear(): Promise<ExecutionResult> {
  try {
    const response = await usersMeApi.clearSchedulePrefs();

    if (!response.success) {
      return {
        success: false,
        message: '❌ 好み設定のクリアに失敗しました。',
      };
    }

    return {
      success: true,
      message: '✅ **スケジュール好み設定をクリアしました**\n\n新しい好みを設定するには、例えば「平日14時以降がいい」と入力してください。',
      data: {
        kind: 'preference.clear',
        payload: null,
      },
    };
  } catch (error) {
    console.error('[preference.clear] Error:', error);
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}
