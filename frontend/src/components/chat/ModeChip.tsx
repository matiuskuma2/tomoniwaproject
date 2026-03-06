/**
 * ModeChip.tsx
 * FE-7 (PR-FE7-b): Mode Chip UI コンポーネント
 * 
 * チャット入力上部に表示されるスケジューリングモード選択チップ
 * PRD: docs/plans/FE-7-MODE-CHIP-UI.md §5
 * 
 * - 6つの Chip: Auto / Fixed / 候補 / 空き / 公開枠 / ご都合伺い
 * - デフォルト: Auto
 * - pending active 時: disabled（opacity-50 + pointer-events-none）
 * - 送信後: Auto にリセットしない（同モードで連続操作を想定）
 * - スレッド切替後: Auto にリセット（useChatReducer で制御）
 * - PC: 6 Chip が1行に全表示
 * - SP: 横スクロール（overflow-x-auto, flex-nowrap）
 */

import type { SchedulingMode } from '../../core/chat/classifier/types';

export interface ModeChipProps {
  /** 現在選択されているモード */
  selectedMode: SchedulingMode;
  /** モード変更コールバック */
  onModeChange: (mode: SchedulingMode) => void;
  /** pending active 時に disabled にする */
  disabled?: boolean;
}

/** Chip 定義（PRD §5.1 の表に準拠） */
interface ChipDef {
  mode: SchedulingMode;
  label: string;
  icon: string;
  /** ツールチップ用の説明 */
  description: string;
}

const CHIPS: ChipDef[] = [
  { mode: 'auto',                 label: 'Auto',     icon: '🤖', description: '入力内容から自動判定' },
  { mode: 'fixed',                label: 'Fixed',    icon: '📌', description: '確定日時で招待' },
  { mode: 'candidates',           label: '候補',     icon: '📋', description: '候補日を提示して選んでもらう' },
  { mode: 'freebusy',             label: '空き',     icon: '📅', description: 'カレンダーの空き時間から自動提案' },
  { mode: 'open_slots',           label: '公開枠',   icon: '🔓', description: '空き枠を公開して相手に選んでもらう' },
  { mode: 'reverse_availability', label: 'ご都合伺い', icon: '🙏', description: '相手のご都合を伺って調整' },
];

export function ModeChip({ selectedMode, onModeChange, disabled = false }: ModeChipProps) {
  return (
    <div
      data-testid="mode-chip-container"
      className={`flex items-center gap-1.5 overflow-x-auto flex-nowrap py-1.5 px-1 ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
      role="radiogroup"
      aria-label="スケジューリングモード選択"
    >
      {CHIPS.map((chip) => {
        const isSelected = selectedMode === chip.mode;
        return (
          <button
            key={chip.mode}
            data-testid={`mode-chip-${chip.mode}`}
            onClick={() => onModeChange(chip.mode)}
            disabled={disabled}
            role="radio"
            aria-checked={isSelected}
            title={chip.description}
            className={`
              flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
              whitespace-nowrap transition-all duration-150 select-none
              border
              ${isSelected
                ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-400 ring-offset-1'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
              }
              ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <span className="text-sm" aria-hidden="true">{chip.icon}</span>
            <span>{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** エクスポート: CHIPS 定義（テスト用） */
export { CHIPS };
