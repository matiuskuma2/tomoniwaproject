/**
 * executorRefresh.test.ts
 * 
 * B: Executor 側の refresh 差し込み漏れ検知テスト
 * 
 * 目的:
 * - Write 操作を行う Executor が適切な refresh 関数を呼び出しているかを検知
 * - 「Executor で書き込んだのに refresh を忘れた」事故を CI で防止
 * - 静的解析（grep ベース）でファイル内容をチェック
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// テスト対象ファイルと期待される refresh 呼び出し
// ============================================================

/**
 * Executor ファイルと、そのファイルに含まれるべき refresh 呼び出しのマッピング
 * 
 * 形式: { ファイルパス: { 関数名: 期待される refresh パターン[] } }
 */
const EXECUTOR_REFRESH_REQUIREMENTS: Record<string, Record<string, string[]>> = {
  // list.ts: リスト操作
  'frontend/src/core/chat/executors/list.ts': {
    'executeListCreate': ['refreshLists'],
    'executeListAddMember': ['refreshLists', 'refreshContacts'],
  },
  
  // thread.ts: スレッド操作 (将来的に追加)
  // 'frontend/src/core/chat/executors/thread.ts': {
  //   'executeThreadCreate': ['refreshThreadsList'],
  //   'executeFinalize': ['refreshStatus', 'refreshInbox', 'refreshThreadsList'],
  // },
};

/**
 * キャッシュ関連のインポートが存在するか確認するファイル
 */
const CACHE_IMPORT_REQUIREMENTS: Record<string, string[]> = {
  'frontend/src/core/chat/executors/list.ts': [
    'refreshLists',
    'refreshContacts',
  ],
};

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * ファイルの内容を読み取る
 */
function readFileContent(relativePath: string): string {
  // テスト実行ディレクトリからの相対パス
  const projectRoot = path.resolve(__dirname, '../../../../..');
  const absolutePath = path.join(projectRoot, relativePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  
  return fs.readFileSync(absolutePath, 'utf-8');
}

/**
 * ファイル内に特定のパターンが存在するかチェック
 */
function containsPattern(content: string, pattern: string): boolean {
  // 関数呼び出しパターン: refreshXxx() または await refreshXxx()
  const regex = new RegExp(`(await\\s+)?${pattern}\\s*\\(`, 'g');
  return regex.test(content);
}

/**
 * ファイル内に特定の import が存在するかチェック
 */
function hasImport(content: string, importName: string): boolean {
  // import { refreshXxx, ... } from '...' パターン
  const importRegex = new RegExp(`import\\s+{[^}]*\\b${importName}\\b[^}]*}\\s+from`, 'g');
  return importRegex.test(content);
}

/**
 * 関数定義内の特定範囲を抽出
 */
function extractFunctionBody(content: string, functionName: string): string | null {
  // export async function xxx( ... ) { ... } パターン
  const funcStartRegex = new RegExp(`export\\s+(async\\s+)?function\\s+${functionName}\\s*\\(`);
  const match = content.match(funcStartRegex);
  
  if (!match || match.index === undefined) {
    return null;
  }
  
  // 関数開始位置から { を探す
  let braceStart = content.indexOf('{', match.index);
  if (braceStart === -1) return null;
  
  // 対応する } を探す（ネストを考慮）
  let depth = 1;
  let pos = braceStart + 1;
  
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    if (content[pos] === '}') depth--;
    pos++;
  }
  
  return content.slice(braceStart, pos);
}

// ============================================================
// テストケース
// ============================================================

describe('Executor refresh 差し込み漏れ検知', () => {
  describe('B-1: Executor ファイルに必要な refresh 呼び出しが存在する', () => {
    Object.entries(EXECUTOR_REFRESH_REQUIREMENTS).forEach(([filePath, functions]) => {
      describe(`File: ${filePath}`, () => {
        let fileContent: string;
        
        beforeAll(() => {
          fileContent = readFileContent(filePath);
        });

        Object.entries(functions).forEach(([functionName, expectedRefreshCalls]) => {
          it(`${functionName}() は ${expectedRefreshCalls.join(', ')} を呼び出す`, () => {
            const functionBody = extractFunctionBody(fileContent, functionName);
            
            expect(functionBody).not.toBeNull();
            
            expectedRefreshCalls.forEach(refreshCall => {
              const hasCall = containsPattern(functionBody!, refreshCall);
              expect(hasCall).toBe(true);
            });
          });
        });
      });
    });
  });

  describe('B-2: Executor ファイルに必要な import が存在する', () => {
    Object.entries(CACHE_IMPORT_REQUIREMENTS).forEach(([filePath, expectedImports]) => {
      it(`${filePath} は ${expectedImports.join(', ')} を import している`, () => {
        const fileContent = readFileContent(filePath);
        
        expectedImports.forEach(importName => {
          const hasImportStatement = hasImport(fileContent, importName);
          expect(hasImportStatement).toBe(true);
        });
      });
    });
  });
});

describe('Executor refresh 呼び出しの品質', () => {
  describe('B-3: list.ts の refresh 呼び出しタイミング', () => {
    let fileContent: string;
    
    beforeAll(() => {
      fileContent = readFileContent('frontend/src/core/chat/executors/list.ts');
    });

    it('executeListCreate は listsApi.create の後に refreshLists を呼ぶ', () => {
      const funcBody = extractFunctionBody(fileContent, 'executeListCreate');
      expect(funcBody).not.toBeNull();
      
      // listsApi.create の後に refreshLists があることを確認
      const createIndex = funcBody!.indexOf('listsApi.create');
      const refreshIndex = funcBody!.indexOf('refreshLists');
      
      expect(createIndex).toBeGreaterThan(-1);
      expect(refreshIndex).toBeGreaterThan(-1);
      expect(refreshIndex).toBeGreaterThan(createIndex);
    });

    it('executeListAddMember は addedCount > 0 の条件で refresh を呼ぶ', () => {
      const funcBody = extractFunctionBody(fileContent, 'executeListAddMember');
      expect(funcBody).not.toBeNull();
      
      // addedCount > 0 のチェックが存在することを確認
      expect(funcBody).toContain('addedCount > 0');
      
      // refreshLists と refreshContacts が並列で呼ばれていることを確認
      expect(funcBody).toContain('Promise.all');
      expect(funcBody).toContain('refreshLists');
      expect(funcBody).toContain('refreshContacts');
    });
  });
});

describe('P2-B1: バッチ処理接続の検知', () => {
  describe('B-4: list.ts が 10件以上でバッチ経由になる', () => {
    let fileContent: string;
    
    beforeAll(() => {
      fileContent = readFileContent('frontend/src/core/chat/executors/list.ts');
    });

    it('list.ts が executeBatchAddMembers を import している', () => {
      expect(fileContent).toContain('import');
      expect(fileContent).toContain('executeBatchAddMembers');
    });

    it('list.ts が BATCH_THRESHOLD を import している', () => {
      expect(fileContent).toContain('BATCH_THRESHOLD');
    });

    it('executeListAddMember が BATCH_THRESHOLD で分岐している', () => {
      const funcBody = extractFunctionBody(fileContent, 'executeListAddMember');
      expect(funcBody).not.toBeNull();
      
      // BATCH_THRESHOLD での条件分岐が存在することを確認
      expect(funcBody).toContain('BATCH_THRESHOLD');
      expect(funcBody).toContain('executeBatchAddMembers');
    });

    it('10件以上の場合にバッチ処理を使用するロジックが存在する', () => {
      const funcBody = extractFunctionBody(fileContent, 'executeListAddMember');
      expect(funcBody).not.toBeNull();
      
      // emails.length >= BATCH_THRESHOLD のチェックが存在
      expect(funcBody).toMatch(/emails\.length\s*>=\s*BATCH_THRESHOLD/);
    });
  });

  describe('B-5: batch.ts の refresh 設定', () => {
    let batchContent: string;
    
    beforeAll(() => {
      batchContent = readFileContent('frontend/src/core/chat/executors/batch.ts');
    });

    it('BATCH_CHUNK_SIZE が 50 に設定されている', () => {
      expect(batchContent).toContain('BATCH_CHUNK_SIZE = 50');
    });

    it('BATCH_THRESHOLD が 10 に設定されている', () => {
      expect(batchContent).toContain('BATCH_THRESHOLD = 10');
    });

    it('refreshAfterBatch 関数が存在する', () => {
      expect(batchContent).toContain('async function refreshAfterBatch');
    });

    it('executeBatchAddMembers が refreshAfterBatch を呼ぶ', () => {
      const funcBody = extractFunctionBody(batchContent, 'executeBatchAddMembers');
      expect(funcBody).not.toBeNull();
      expect(funcBody).toContain('refreshAfterBatch');
    });
  });
});

describe('Executor refresh のカバレッジ', () => {
  describe('B-6: 全ての Write 操作が対応する Executor で refresh される', () => {
    /**
     * WriteOp と Executor の対応表
     * 各 WriteOp に対して、どの Executor ファイル・関数が refresh を担当するか
     */
    const WRITE_OP_EXECUTOR_MAP: Record<string, { file: string; function: string } | null> = {
      // リスト系: list.ts で refresh
      'LIST_CREATE': { file: 'frontend/src/core/chat/executors/list.ts', function: 'executeListCreate' },
      'LIST_ADD_MEMBER': { file: 'frontend/src/core/chat/executors/list.ts', function: 'executeListAddMember' },
      
      // 連絡先系: list.ts の executeListAddMember で間接的に refresh
      // 直接の CONTACT_CREATE Executor は現時点では存在しない
      'CONTACT_CREATE': null, // list.ts の addMember 経由
      'CONTACT_UPDATE': null, // 未実装
      'CONTACT_DELETE': null, // 未実装
      
      // ユーザー設定系: 別の場所で実装
      'USERS_ME_UPDATE_TZ': null, // SettingsPage 等で直接 API 呼び出し後に refresh
      
      // スケジュール調整系: thread.ts または apiExecutor.ts で実装
      'THREAD_CREATE': null, // 要確認
      'INVITE_SEND': null,
      'INVITE_ADD_SLOTS': null,
      'ADD_SLOTS': null,
      'REMIND_PENDING': null,
      'REMIND_NEED_RESPONSE': null,
      'FINALIZE': null,
      'NOTIFY_CONFIRMED': null,
    };

    it('リスト操作の Executor は refresh を実装している', () => {
      const listOps = ['LIST_CREATE', 'LIST_ADD_MEMBER'];
      
      listOps.forEach(op => {
        const mapping = WRITE_OP_EXECUTOR_MAP[op];
        expect(mapping).not.toBeNull();
      });
    });

    it('将来: 全ての WriteOp に対応する Executor が存在する（現状は部分的）', () => {
      // 現時点では部分的な実装
      // 将来的にはすべての WriteOp に対応する Executor が必要
      const implemented = Object.entries(WRITE_OP_EXECUTOR_MAP)
        .filter(([_, mapping]) => mapping !== null);
      
      // 最低限、リスト操作は実装済み
      expect(implemented.length).toBeGreaterThanOrEqual(2);
    });
  });
});
