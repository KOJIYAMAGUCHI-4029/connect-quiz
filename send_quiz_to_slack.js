/**
 * CONNECT 医師紹介クイズ - 毎日Slack送信スクリプト
 * 
 * 【設定方法】
 * 1. SLACK_CHANNEL に正確なチャンネル名を設定（例: "営業部"）
 * 2. このスクリプトをClaudeのSlackコネクタ経由で毎朝9時に実行
 * 
 * 【動作】
 * - セクション1〜47（医師紹介基礎知識）からランダムで3問選出
 * - 問題文と選択肢のみ送信（回答なし）
 * - 回答確認用URLを末尾に表示
 */

// ============================================================
// ★ 設定項目（チャンネル名が決まったら変更してください）
// ============================================================
const SLACK_CHANNEL = "営業"; // ← チャンネル名をここに設定
const QUIZ_URL = "https://kojiyamaguchi-4029.github.io/connect-quiz/index.html?mode=daily-answer";

// ============================================================
// 問題データ読み込み
// ============================================================
const fs = require('fs');
const questions = JSON.parse(fs.readFileSync('./quiz_medical.json', 'utf-8'));

// ============================================================
// ランダム3問選出
// ============================================================
function pickRandom(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const selected = pickRandom(questions, 3);

// ============================================================
// メッセージ組み立て
// ============================================================
const today = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
});

const labels = ['A', 'B', 'C', 'D'];

let message = `🏥 *今日の医師紹介クイズ 3問* ｜ ${today}\n`;
message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

selected.forEach((q, idx) => {
  message += `*【問題${idx + 1}】* _${q.section}_\n`;
  message += `${q.q}\n\n`;
  q.c.forEach((choice, i) => {
    message += `　${labels[i]}. ${choice}\n`;
  });
  message += `\n`;
});

message += `━━━━━━━━━━━━━━━━━━━━━\n`;
message += `<${QUIZ_URL}|📱 今日の回答・解説を見る>`;

// ============================================================
// Slack送信（Claude Slack コネクタ経由）
// ============================================================
console.log("送信チャンネル:", SLACK_CHANNEL);
console.log("メッセージ内容:\n");
console.log(message);

module.exports = { message, channel: SLACK_CHANNEL };
