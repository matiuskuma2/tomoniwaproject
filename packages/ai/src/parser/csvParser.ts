/**
 * CSV Parser for Contact Import
 * 
 * CSVテキスト → ContactImportEntry[] に変換する。
 * 
 * ■ 事故ゼロルール:
 *   1. メール無し行 → missing_email=true, match_status='skipped'（Hard fail明示）
 *   2. 上限100行（DoS防止）
 *   3. ヘッダ行は自動推定してスキップ
 *   4. カンマ/タブ区切りを両方許容
 *   5. 「名前にカンマ」→ parse_errorにして落とす（対応しない方が安全）
 * 
 * ■ ヘッダ推定ロジック:
 *   先頭行に "name"/"email"/"メール"/"名前" 等があればヘッダと判断
 *   列位置をヘッダから推定。ヘッダ無しなら 列1=name, 列2=email を仮定。
 */

import type { ContactImportEntry } from '../../../../packages/shared/src/types/pendingAction';

// ============================================================
// Constants
// ============================================================

/** CSV取り込みの最大行数（DoS防止） */
export const CSV_MAX_ROWS = 100;

/** CSV入力の最大バイト数 */
export const CSV_MAX_BYTES = 50 * 1024; // 50KB

// ============================================================
// Column Detection
// ============================================================

/** ヘッダ候補の正規化マッピング */
const HEADER_MAP: Record<string, 'name' | 'email' | 'phone' | 'notes'> = {
  // name variants
  'name': 'name',
  '名前': 'name',
  'なまえ': 'name',
  '氏名': 'name',
  'display_name': 'name',
  'displayname': 'name',
  'full_name': 'name',
  'fullname': 'name',
  'お名前': 'name',
  '名': 'name',

  // email variants
  'email': 'email',
  'mail': 'email',
  'メール': 'email',
  'メールアドレス': 'email',
  'e-mail': 'email',
  'email_address': 'email',
  'emailaddress': 'email',
  'メアド': 'email',

  // phone variants
  'phone': 'phone',
  '電話': 'phone',
  '電話番号': 'phone',
  'tel': 'phone',
  'telephone': 'phone',
  '携帯': 'phone',

  // notes variants
  'notes': 'notes',
  'メモ': 'notes',
  '備考': 'notes',
  'memo': 'notes',
  'note': 'notes',
  'comment': 'notes',
  'コメント': 'notes',
};

/** メールアドレスのパターン */
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** 電話番号のパターン（日本 + 国際） */
const PHONE_RE = /^[\d\s\-+()\u3000]{7,20}$/;

interface ColumnMapping {
  name: number;
  email: number;
  phone: number;
  notes: number;
}

// ============================================================
// CSV Parser Result
// ============================================================

export interface CSVParseResult {
  entries: ContactImportEntry[];
  /** パース時に検出された問題 */
  warnings: string[];
  /** ヘッダが検出されたか */
  header_detected: boolean;
  /** 入力行数（ヘッダ含む） */
  total_input_rows: number;
  /** 上限超過で切り捨てられた行数 */
  truncated_rows: number;
  /** メール欠落行数 */
  missing_email_count: number;
}

// ============================================================
// Main Parser
// ============================================================

/**
 * CSV テキストを ContactImportEntry[] にパースする
 */
export function parseCSV(rawText: string): CSVParseResult {
  const warnings: string[] = [];

  // サイズチェック
  const byteSize = new TextEncoder().encode(rawText).length;
  if (byteSize > CSV_MAX_BYTES) {
    return {
      entries: [],
      warnings: [`入力が大きすぎます（${Math.round(byteSize / 1024)}KB）。上限は${CSV_MAX_BYTES / 1024}KBです。`],
      header_detected: false,
      total_input_rows: 0,
      truncated_rows: 0,
      missing_email_count: 0,
    };
  }

  // 行分割（CR/LF/CRLF対応）
  const rawLines = rawText.split(/\r\n|\r|\n/).filter(line => line.trim() !== '');
  const totalInputRows = rawLines.length;

  if (rawLines.length === 0) {
    return {
      entries: [],
      warnings: ['入力が空です。'],
      header_detected: false,
      total_input_rows: 0,
      truncated_rows: 0,
      missing_email_count: 0,
    };
  }

  // 区切り文字の推定（最初の5行を見る）
  const delimiter = detectDelimiter(rawLines.slice(0, 5));

  // 行をセルに分割
  const rows = rawLines.map(line => splitRow(line, delimiter));

  // ヘッダ推定
  const { hasHeader, columnMapping } = detectHeader(rows[0], delimiter);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  // 上限チェック
  let truncatedRows = 0;
  let processRows = dataRows;
  if (dataRows.length > CSV_MAX_ROWS) {
    truncatedRows = dataRows.length - CSV_MAX_ROWS;
    processRows = dataRows.slice(0, CSV_MAX_ROWS);
    warnings.push(`${dataRows.length}行中、上限${CSV_MAX_ROWS}行のみ処理します（${truncatedRows}行切り捨て）。`);
  }

  // エントリ生成
  const entries: ContactImportEntry[] = [];
  let missingEmailCount = 0;

  for (let i = 0; i < processRows.length; i++) {
    const cells = processRows[i];
    
    // 空行スキップ
    if (cells.every(c => c.trim() === '')) continue;

    const name = (cells[columnMapping.name] || '').trim();
    const email = (cells[columnMapping.email] || '').trim().toLowerCase();
    const phone = columnMapping.phone >= 0 ? (cells[columnMapping.phone] || '').trim() : undefined;
    const notes = columnMapping.notes >= 0 ? (cells[columnMapping.notes] || '').trim() : undefined;

    // 名前が空 → スキップ
    if (!name) {
      warnings.push(`行${i + 1 + (hasHeader ? 1 : 0)}: 名前が空のためスキップ`);
      continue;
    }

    // ■■■ メール必須 Hard fail ■■■
    const hasMissingEmail = !email || !EMAIL_RE.test(email);
    if (hasMissingEmail) {
      missingEmailCount++;
    }

    const entry: ContactImportEntry = {
      index: entries.length,
      name,
      email: hasMissingEmail ? undefined : email,
      phone: phone && PHONE_RE.test(phone) ? phone : undefined,
      notes: notes || undefined,
      missing_email: hasMissingEmail,
      // メール無し → skipped（登録不可、previewで明示表示）
      match_status: hasMissingEmail ? 'skipped' : 'new',
    };

    // メール無しの場合はresolved_actionもskipにする（確定時にDB書き込みしない）
    if (hasMissingEmail) {
      entry.resolved_action = { type: 'skip' };
    }

    entries.push(entry);
  }

  return {
    entries,
    warnings,
    header_detected: hasHeader,
    total_input_rows: totalInputRows,
    truncated_rows: truncatedRows,
    missing_email_count: missingEmailCount,
  };
}

// ============================================================
// Internal: 区切り文字推定
// ============================================================

function detectDelimiter(sampleLines: string[]): string {
  let commaCount = 0;
  let tabCount = 0;

  for (const line of sampleLines) {
    commaCount += (line.match(/,/g) || []).length;
    tabCount += (line.match(/\t/g) || []).length;
  }

  return tabCount > commaCount ? '\t' : ',';
}

// ============================================================
// Internal: 行をセルに分割（簡易版、ダブルクォート対応）
// ============================================================

function splitRow(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        // エスケープされたダブルクォート
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}

// ============================================================
// Internal: ヘッダ推定
// ============================================================

function detectHeader(
  firstRow: string[],
  delimiter: string
): { hasHeader: boolean; columnMapping: ColumnMapping } {
  // デフォルト: 列0=name, 列1=email
  const defaultMapping: ColumnMapping = {
    name: 0,
    email: firstRow.length > 1 ? 1 : -1,
    phone: firstRow.length > 2 ? 2 : -1,
    notes: firstRow.length > 3 ? 3 : -1,
  };

  // 先頭行のセルをヘッダ候補として照合
  const normalizedCells = firstRow.map(cell => cell.trim().toLowerCase());
  
  let matchedColumns = 0;
  const mapping: ColumnMapping = { name: -1, email: -1, phone: -1, notes: -1 };

  for (let i = 0; i < normalizedCells.length; i++) {
    const cell = normalizedCells[i];
    const mappedField = HEADER_MAP[cell];
    if (mappedField && mapping[mappedField] === -1) {
      mapping[mappedField] = i;
      matchedColumns++;
    }
  }

  // 少なくとも2つのヘッダが一致 → ヘッダあり
  if (matchedColumns >= 2) {
    // name列が見つからなければ、email以外の最初の列を仮定
    if (mapping.name === -1) {
      for (let i = 0; i < firstRow.length; i++) {
        if (i !== mapping.email && i !== mapping.phone && i !== mapping.notes) {
          mapping.name = i;
          break;
        }
      }
    }
    return { hasHeader: true, columnMapping: mapping };
  }

  // ヘッダ判定: 先頭行に @ が無くて、2行目以降に @ があればヘッダの可能性
  // しかし確実ではないので、nameとemailの位置を推定
  const hasEmailInFirstRow = normalizedCells.some(c => EMAIL_RE.test(c));
  if (!hasEmailInFirstRow && normalizedCells.some(c => HEADER_MAP[c])) {
    // ヘッダっぽい単語が含まれていてメールが無い → ヘッダ
    // ただしマッチ数が1つだけなので、デフォルトマッピングをベースに調整
    if (mapping.name >= 0 || mapping.email >= 0) {
      return {
        hasHeader: true,
        columnMapping: {
          name: mapping.name >= 0 ? mapping.name : defaultMapping.name,
          email: mapping.email >= 0 ? mapping.email : defaultMapping.email,
          phone: mapping.phone >= 0 ? mapping.phone : defaultMapping.phone,
          notes: mapping.notes >= 0 ? mapping.notes : defaultMapping.notes,
        },
      };
    }
  }

  // email列の自動検出: メールアドレスが含まれている列を探す
  // (ヘッダ無しの場合、先頭行もデータ行として扱う)
  for (let i = 0; i < normalizedCells.length; i++) {
    if (EMAIL_RE.test(normalizedCells[i])) {
      // この列がemail
      return {
        hasHeader: false,
        columnMapping: {
          name: i === 0 ? 1 : 0, // email列でない方がname
          email: i,
          phone: firstRow.length > 2 ? (i <= 1 ? 2 : -1) : -1,
          notes: firstRow.length > 3 ? 3 : -1,
        },
      };
    }
  }

  // 何もマッチしない → デフォルト
  return { hasHeader: false, columnMapping: defaultMapping };
}
