/**
 * CONNECT 医療業界知識クイズ - Slack自動送信スクリプト
 * ====================================================
 * GitHub Actions から毎朝9時（JST）に実行
 * index.html 内の quizData を読み取り、3問ずつ送信
 * 平日のみ（cron側で制御）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================================
// 設定
// ============================================================
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || 'C0144FZUBDK';
const DAILY_QUESTION_COUNT = 3;
const PROGRESS_FILE = path.join(__dirname, '..', 'quiz-progress.json');

// ============================================================
// index.html からクイズデータを抽出
// ============================================================
function extractQuizData() {
    const htmlPath = path.join(__dirname, '..', '..', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // quizData の JSON配列を抽出
    const match = html.match(/const\s+quizData\s*=\s*(\[[\s\S]*?\]);\s*\n/);
    if (!match) {
        throw new Error('index.html 内に quizData が見つかりません');
    }

    // JSON として解析
    const quizData = eval(match[1]);
    return quizData;
}

// ============================================================
// 全問題をフラットなリストに変換（セクション1〜47のみ対象）
// ============================================================
function getAllQuestions(quizData) {
    const allQ = [];
    for (const section of quizData) {
        // セクション番号を取得（先頭の数字部分）
        const secNumMatch = section.section.match(/^(\d+)/);
        const secNum = secNumMatch ? parseInt(secNumMatch[1]) : 999;

        // セクション1〜47のみ対象（番外編・総裁選等は除外）
        if (secNum > 47) continue;

        for (const q of section.questions) {
            allQ.push({
                section: section.section,
                id: q.id,
                q: q.q,
                choices: q.c,
                answer: q.a,
                explanation: q.e
            });
        }
    }
    return allQ;
}

// ============================================================
// 進捗管理
// ============================================================
function loadProgress() {
    try {
        if (fs.existsSync(PROGRESS_FILE)) {
            return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.log('進捗ファイル読み込みエラー:', e.message);
    }
    return { currentIndex: 0, dayCount: 0, lastSentDate: null };
}

function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
}

// ============================================================
// Slack API 送信
// ============================================================
function slackPost(method, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const options = {
            hostname: 'slack.com',
            path: `/api/${method}`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    if (!parsed.ok) {
                        reject(new Error(`Slack API Error: ${parsed.error}`));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`JSON parse error: ${responseData}`));
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
    // Bot Token チェック
    if (!SLACK_BOT_TOKEN) {
        console.error('[ERROR] SLACK_BOT_TOKEN が設定されていません');
        process.exit(1);
    }

    // 進捗読み込み
    const progress = loadProgress();

    // 二重送信防止
    const today = new Date().toISOString().split('T')[0];
    if (progress.lastSentDate === today) {
        console.log(`[INFO] ${today} は既に送信済みです`);
        return;
    }

    // クイズデータ読み込み
    const quizData = extractQuizData();
    const allQuestions = getAllQuestions(quizData);
    const total = allQuestions.length;

    console.log(`[INFO] 全${total}問（セクション1〜47）から出題`);

    // 今日の出題範囲を決定
    const startIdx = progress.currentIndex % total;
    const todayQuestions = [];
    for (let i = 0; i < DAILY_QUESTION_COUNT; i++) {
        const idx = (startIdx + i) % total;
        todayQuestions.push(allQuestions[idx]);
    }

    const dayCount = progress.dayCount + 1;
    const labels = ['A', 'B', 'C', 'D'];

    // ============================================================
    // 問題メッセージを作成
    // ============================================================
    let message = `:books: *医療業界知識クイズ Day ${dayCount}*\n`;
    message += `（全${total}問中 第${startIdx + 1}〜${startIdx + DAILY_QUESTION_COUNT}問目）\n`;
    message += `━━━━━━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < todayQuestions.length; i++) {
        const q = todayQuestions[i];
        message += `*Q${i + 1}. [${q.section}]*\n`;
        message += `${q.q}\n`;
        if (q.choices && q.choices.length > 0) {
            for (let j = 0; j < q.choices.length; j++) {
                message += `${labels[j]}. ${q.choices[j]}\n`;
            }
        }
        message += `\n`;
    }

    message += `:point_down: *回答はスレッドをチェック！*`;

    // ============================================================
    // 回答メッセージを作成
    // ============================================================
    let answerText = `:white_check_mark: *本日の回答*\n`;
    answerText += `━━━━━━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < todayQuestions.length; i++) {
        const q = todayQuestions[i];
        const correctLabel = labels[q.answer];
        const correctText = q.choices ? q.choices[q.answer] : '';
        answerText += `*A${i + 1}. [${q.section}]*\n`;
        if (q.choices && q.choices.length > 0) {
            answerText += `:bulb: *正解: ${correctLabel}. ${correctText}*\n`;
        }
        if (q.explanation) {
            answerText += `${q.explanation}\n`;
        }
        answerText += `\n`;
    }

    // クイズアプリへのリンク
    answerText += `\n:arrow_right: もっと挑戦する → https://kojiyamaguchi-4029.github.io/connect-quiz/`;

    // ============================================================
    // Slack送信
    // ============================================================
    console.log('[INFO] 問題を送信中...');

    // 1. 問題を送信
    const result = await slackPost('chat.postMessage', {
        channel: CHANNEL_ID,
        text: message
    });

    console.log('[OK] 問題送信完了');

    // 2. スレッドに回答を投稿
    await slackPost('chat.postMessage', {
        channel: CHANNEL_ID,
        text: answerText,
        thread_ts: result.ts
    });

    console.log('[OK] スレッド回答送信完了');

    // ============================================================
    // 進捗を更新
    // ============================================================
    const nextIndex = (startIdx + DAILY_QUESTION_COUNT) % total;
    progress.currentIndex = nextIndex;
    progress.dayCount = dayCount;
    progress.lastSentDate = today;
    saveProgress(progress);

    console.log(`[INFO] Day ${dayCount}: ${DAILY_QUESTION_COUNT}問送信完了`);
    console.log(`[INFO] 次回は第${nextIndex + 1}問目から出題`);
    if (nextIndex < startIdx) {
        console.log('[INFO] 全問出題完了！次回から最初に戻ります');
    }
}

main().catch(err => {
    console.error('[ERROR]', err.message);
    process.exit(1);
});
