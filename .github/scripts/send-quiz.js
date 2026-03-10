/**
 * CONNECT 医療業界知識クイズ - Slack自動送信スクリプト
 * ====================================================
 * GitHub Actions から毎朝9時（JST）に実行
 * index.html 内の quizData を読み取り、3問ずつ送信
 * 平日のみ（cron側で制御）
 * ※ 日付ベースのシードでシャッフルし、毎日違う問題を出題
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || 'C0144FZUBDK';
const DAILY_QUESTION_COUNT = 3;
const PROGRESS_FILE = path.join(__dirname, '..', 'quiz-progress.json');

function seededRandom(seed) {
    let s = seed;
    return function() {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
    };
}

function shuffleWithSeed(array, seed) {
    const arr = [...array];
    const rand = seededRandom(seed);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getTodaySeed() {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    return parseInt(today, 10);
}

function extractQuizData() {
    const htmlPath = path.join(__dirname, '..', '..', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const match = html.match(/const\s+quizData\s*=\s*(\[[\s\S]*?\]);\s*\n/);
    if (!match) throw new Error('index.html 内に quizData が見つかりません');
    return eval(match[1]);
}

function getAllQuestions(quizData) {
    const allQ = [];
    for (const section of quizData) {
        const secNumMatch = section.section.match(/^(\d+)/);
        const secNum = secNumMatch ? parseInt(secNumMatch[1]) : 999;
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

function loadProgress() {
    try {
        if (fs.existsSync(PROGRESS_FILE)) {
            return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.log('進捗ファイル読み込みエラー:', e.message);
    }
    return { dayCount: 0, lastSentDate: null, usedIds: [] };
}

function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
}

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
                    if (!parsed.ok) reject(new Error(`Slack API Error: ${parsed.error}`));
                    else resolve(parsed);
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

async function main() {
    if (!SLACK_BOT_TOKEN) {
        console.error('[ERROR] SLACK_BOT_TOKEN が設定されていません');
        process.exit(1);
    }

    const progress = loadProgress();
    const today = new Date().toISOString().split('T')[0];

    if (progress.lastSentDate === today) {
        console.log(`[INFO] ${today} は既に送信済みです`);
        return;
    }

    const quizData = extractQuizData();
    const allQuestions = getAllQuestions(quizData);
    const total = allQuestions.length;
    console.log(`[INFO] 全${total}問（セクション1〜47）から出題`);

    let usedIds = progress.usedIds || [];
    const unusedQuestions = allQuestions.filter(q => !usedIds.includes(q.id));
    if (unusedQuestions.length < DAILY_QUESTION_COUNT) {
        console.log('[INFO] 全問出題完了！最初からやり直します');
        usedIds = [];
    }

    const seed = getTodaySeed();
    const pool = usedIds.length === 0 ? allQuestions : allQuestions.filter(q => !usedIds.includes(q.id));
    const shuffled = shuffleWithSeed(pool, seed);
    const todayQuestions = shuffled.slice(0, DAILY_QUESTION_COUNT);

    const dayCount = progress.dayCount + 1;
    const labels = ['A', 'B', 'C', 'D'];

    let message = `:books: *医療業界知識クイズ Day ${dayCount}*\n`;
    message += `━━━━━━━━━━━━━━━━━━\n\n`;
    for (let i = 0; i < todayQuestions.length; i++) {
        const q = todayQuestions[i];
        message += `*Q${i + 1}. [${q.section}]*\n${q.q}\n`;
        if (q.choices && q.choices.length > 0) {
            for (let j = 0; j < q.choices.length; j++) {
                message += `${labels[j]}. ${q.choices[j]}\n`;
            }
        }
        message += `\n`;
    }
    message += `:point_down: *回答はスレッドをチェック！*`;

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
        if (q.explanation) answerText += `${q.explanation}\n`;
        answerText += `\n`;
    }
    answerText += `\n:arrow_right: もっと挑戦する → https://kojiyamaguchi-4029.github.io/connect-quiz/select.html`;

    console.log('[INFO] 問題を送信中...');
    const result = await slackPost('chat.postMessage', { channel: CHANNEL_ID, text: message });
    console.log('[OK] 問題送信完了');

    await slackPost('chat.postMessage', { channel: CHANNEL_ID, text: answerText, thread_ts: result.ts });
    console.log('[OK] スレッド回答送信完了');

    const newUsedIds = [...usedIds, ...todayQuestions.map(q => q.id)];
    progress.dayCount = dayCount;
    progress.lastSentDate = today;
    progress.usedIds = newUsedIds;
    saveProgress(progress);

    console.log(`[INFO] Day ${dayCount}: ${DAILY_QUESTION_COUNT}問送信完了`);
    console.log(`[INFO] 残り未出題数: ${total - newUsedIds.length}問`);
}

main().catch(err => {
    console.error('[ERROR]', err.message);
    process.exit(1);
});
