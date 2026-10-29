# 光電時光機：上課版使用說明

先進光電科技與人類文明・第 1 組期末報告（12/16）用的互動遊戲。台上放簡報，台下用手機玩，組員用控制台控制進度。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 玩家頁（台下同學掃 QR code 進來的頁面） |
| `host.html` | 主持人控制台（組員操作） |
| `board.html` | 大螢幕排行榜（選用，結算時切過去幾秒） |
| `practice.html` | 練習模式：不需要網路、不需要 Firebase，35 位模擬同學自動參加 |
| `config.js` | 填 Firebase 設定的地方 |
| `firestore.rules` | Firestore 安全規則，要貼到 Firebase 主控台 |
| `data.js` `core.js` `game.js` `local-store.js` `firebase-store.js` | 程式與股價資料 |

## 一、先用練習模式彩排

直接用瀏覽器打開 `practice.html` 就能玩：左邊是控制台，右邊是你的手機畫面，也可以切到大螢幕排行榜。

## 二、建立 Firebase（一位組員做，約 5 分鐘）

1. 到 https://console.firebase.google.com ，用 Google 帳號「建立專案」（Google Analytics 可以不開）。
2. 左側找到「Firestore Database」→「建立資料庫」，版本選 **Standard**，位置選 `asia-east1（台灣）`，模式選哪個都可以。
3. 建好後切到「規則」分頁，把 `firestore.rules` 的內容整個貼上，按「發布」。
4. 左側「安全性（Security）→ Authentication」→「開始使用」→「登入方式」分頁 → 啟用「匿名」→ 儲存。找不到的話，直接開 `https://console.firebase.google.com/project/專案ID/authentication/providers`。
5. 專案總覽旁的齒輪 →「專案設定」→ 下方「你的應用程式」點 `</>`（網頁）→ 隨便取個名字註冊。
6. 畫面會出現一段 `firebaseConfig`，把裡面的值填進 `config.js`。安裝 SDK、Firebase CLI、部署到 Firebase Hosting 這幾步都不用做，直接按「繼續前往控制台」。（本專案 photonics-final 已填好）

## 三、放到 GitHub Pages（讓全班掃得到）

1. 在 GitHub 建立一個新的 public repository（例如 `photonics-time-machine`）。
2. 「Add file → Upload files」，把這個資料夾裡的所有檔案拖進去，按「Commit changes」。
3. 「Settings → Pages」，Source 選「Deploy from a branch」，Branch 選 `main`、資料夾 `/ (root)`，按「Save」。
4. 等一兩分鐘，網址會是 `https://你的帳號.github.io/photonics-time-machine/`。
5. 回 Firebase「Authentication → 設定 → 授權網域」，新增 `你的帳號.github.io`。

## 四、上課當天

1. 打開 `https://你的帳號.github.io/photonics-time-machine/host.html`，會自動產生一場新遊戲，網址列出現 `?g=遊戲代碼&k=金鑰`。**這個網址請加入書籤**，重新整理也會回到同一場。
2. 控制台上有玩家網址和 QR code，截圖放進簡報第一頁。
3. 按鈕順序：

| 時機 | 按鈕 | 台下手機 |
|---|---|---|
| 人到齊 | 開始遊戲 | 進入 2006 年的分配 |
| 背景講完 | 鎖定 | 不能再改，顯示自己的配置和全班押在哪 |
| 這五年講完 | 快轉 5 年 | 跳到五年後：走勢圖、成績、名次、排行榜，並開放下一輪分配 |
| （重複四輪） | | |
| 結尾，有時間才按 | 開放 2031 預測 | 投票預測 2026–2031 |

4. 控制台在快轉後會顯示前三名，主持人可以直接唸出來。
5. 按錯可以按「復原上一步」。「重設遊戲」會讓全班重新加入，只在彩排後使用。
6. 控制台的「控制台備援」網址可以給另一位組員，用另一台裝置也能操作同一場。

## 五、規則與注意事項

- 鎖定前沒分配完的部分算現金；中途加入的人從當輪拿 10 萬元開始。
- 第 2 輪起，手機預設「續抱不動」，沿用上一輪的持股；一調整就改成重新分配。
- 股價為還原權息報酬（配股、配息、減資都已換算），資料來源 FinMind（證交所、櫃買中心公開資料）。晶電 2020 年下市後，依 1 股換 0.5 股改持有富采。現金假設年利率 1%。
- Firebase 免費額度每天 5 萬次讀取，一場 100 人的遊戲大約用 1 到 2 萬次。正式報告當天不要再用全班規模彩排。
- 萬一教室網路不穩：改用 `practice.html` 在大螢幕跑完。

## 六、要換公司

改 `core.js` 最上面 `TM.CATS` 的 `pick`，並在 `data.js` 補上該公司的還原股價。資料需要另外抓取。
