# TwoTrack

During group work, TwoTrack shows the teacher every group's progress on one screen, so they can finish the whole lesson.

Each group works through the teacher's own worksheet on a class computer, one problem at a time, checked right or wrong straight away. The teacher's live board shows, for every group:

- which activity they're on
- how many problems they've finished
- how long since their last answer
- a flag when they've gone quiet or keep getting the same problem wrong

At the end, each student does the exit ticket on their own, and the teacher gets everyone's score.

The plan this was built from is in [docs/mvp-plan.md](docs/mvp-plan.md).

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm start
```

Open http://localhost:3000/teacher to set up a lesson. Students go to http://localhost:3000.

To turn on **Fun Mode**, set an Anthropic API key before starting:

```sh
ANTHROPIC_API_KEY=sk-ant-... npm start
```

| Setting | What it does |
|---|---|
| `PORT` | Port to listen on (default 3000). |
| `ANTHROPIC_API_KEY` | Turns on Fun Mode, calling Claude directly. |
| `AI_GATEWAY_API_KEY` | Turns on Fun Mode through Vercel AI Gateway. Not needed on a Vercel deployment, which signs in on its own. An Anthropic key (`sk-ant-...`) saved here is used as `ANTHROPIC_API_KEY` instead. |
| `FUN_MODE` | `off` to turn Fun Mode off even with a key; `on` to use other Claude credentials (for example an `ant auth login` profile). |
| `FUN_MODE_MODEL` | Model for Fun Mode. Default `claude-opus-5-5` directly. Through the gateway, it tries `anthropic/claude-opus-5.5` and falls back to `anthropic/claude-opus-5`. |

### Putting it online for the test

The class computers need to reach it, so for the real lesson run it on any host that runs Node (Render, Railway, Fly.io, a school server). The start command is `npm start`.

- **Everything lives in memory.** Restarting the server ends every class. Don't redeploy during a lesson.
- **Free hosting tiers often go to sleep** when nobody uses them for a while, and that wipes memory too. Start the class at the start of the period, not at lunch. The setup page remembers the worksheet in the teacher's browser, so restarting a class takes one click.
- **Try it on one of the actual class computers before the lesson.** School networks block a lot of sites.

### Hosting on Vercel

A demo is live at **https://twotrack-ten.vercel.app**.

`vercel.json` serves `public/` as static pages and sends every `/api/...` request to one function, `api/index.js`, which runs the same app as `npm start`.

- **Fine for trying it out, not yet for a real lesson.** Classes live in the function's memory, and Vercel doesn't keep one copy of the function running. It shuts down idle copies, starts fresh ones on every deploy, and can run several at once when busy. When that happens, a class vanishes ("No class with that code"). Before the real test, either move class state into a shared store (Upstash Redis from the Vercel Marketplace has a free tier), or run `npm start` on an always-on host.
- **Fun Mode works on Vercel with no setup.** It calls Claude through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), signed in with the deployment's own OIDC token, and the cost comes out of the Vercel account's AI Gateway credits. Each rewrite is a fraction of a cent. To call Anthropic directly instead (the demo does), add `ANTHROPIC_API_KEY` under Settings → Environment Variables and redeploy. That key takes priority over the gateway.

## In class

**Teacher**

1. Go to `/teacher`, paste the worksheet and the exit ticket with their answers, and set the number of groups. The right-hand side shows exactly what students will get. Anything in red (like a problem with no answer) has to be fixed before you can start.
2. Press **Start class**. You get a class code and the live board.
3. Press **Show code on smartboard** and put that window on the board. It shows the code in big letters and which groups have joined.
4. Press **Open on your phone** to carry the board while you walk around. On your phone, go to `/board` and type the class code and the 6-digit PIN. Keep the PIN to yourself.
5. On the board:
   - A red card means **stuck**: the group got the same problem wrong 3 times in a row.
   - An amber card means **quiet**: no answer in 3 minutes.
   - The "Go to:" line lists every group that needs you.
   - After you've visited a group, tap **Checked on them** to clear the flag.
   - If a group is truly stuck, tap **Skip this problem**. It counts as skipped, not finished.
   - **Settings** changes the 3 minutes and the 3 tries.
6. Groups move to the exit ticket on their own when they finish. If time is running out, press **Start the exit ticket for everyone**.
7. Exit tickets appear on the board as they come in, with each student's answers and the percentage right per question. **Download results** gives you a spreadsheet. Then press **Clear class data** to delete everything.

**Students**

1. Go to the site, type the class code and a group name. If the page closes, join again with the same name to pick up where you left off.
2. Answer one problem at a time. The next activity unlocks when you finish the current one.
3. **Fun Mode** (optional): tell it what your group is into, and each problem is rewritten around it. The numbers and the answer stay the same, and the original math is always shown underneath.
4. At the exit ticket, take turns. Each student types their first name, answers on their own, hands it in, and passes the computer on.

## Worksheet format

```
Lesson: Solving two-step equations

Activity 1: Warm-up
Directions: Solve each equation.
1. x + 7 = 15
Answer: 8
2. 3x = 21
Answer: x = 7 | 7

Activity 2: Two-step equations
1. 2x + 3 = 11
Answer: 4
```

- Start an activity with `Activity 1: ...`. `Part`, `Section`, `Station`, `Task`, `Round` and `Level` work too, as does a Markdown heading (`## Warm-up`). With no headings, the whole sheet is one activity.
- Number the problems (`1.`, `1)`, `Q1:`). A problem can run over several lines.
- Put each answer on the line after its problem as `Answer: ...` (or `Ans:` / `A:`), or at the end of the problem line as `(Answer: 4)`.
- If the key is separate, add a line `Answer key` and then numbered answers (`1. 4   2. 7` works). You can put `Activity 2` lines inside the key.
- Separate more than one accepted answer with `|`.
- An `Exit ticket` heading inside the worksheet works too, as well as the separate exit ticket box.

The sample lesson (**Load a sample lesson** on the setup page) is a full example.

## How answers are checked

Answers are only ever checked against the teacher's key, on the server. The key is never sent to the students' computers.

The checker accepts the same answer written a different way:

| Counts as the same | Example |
|---|---|
| With or without the variable | `x = 4` and `4`, also `4 = x` |
| Number forms | `1/2`, `0.5`, `.5`, `2/4`; `1 1/2` and `1.5`; `$12.50` and `12.5`; `1,000`; `12 cm` and `12` |
| Rounding a fraction | `0.33` or `0.333` for `1/3`. The rounding has to be correct, with at least 2 decimal places. A decimal the teacher typed must match exactly. |
| Order and notation | `3 + 2x` and `2x + 3`; `(x+3)(x+2)` and `(x+2)(x+3)`; `0.5x` and `x/2`; `x²` and `x^2` |
| Equations | `y = 3 + 2x` and `2x + 3 = y` for `y = 2x + 3` |
| Inequalities | `4 < x` and `x > 4`; `≥` and `>=` |
| Points and systems | `(2, 3)` and `x = 2, y = 3` |
| Several solutions, any order | `x = 2 or x = -3` and `-3, 2` |
| Words | case, spaces and a final period don't matter |

It does **not** do the student's work for them. `x^2 + 5x + 6` is not accepted for `(x + 2)(x + 3)`, and `2(x + 3)` is not accepted for `2x + 6`, so factoring and simplifying problems still test something. To accept something else, list it with `|`.

## Fun Mode and the one rule

The AI only rewrites the wording. Every Fun Mode rewrite is checked in code before a group sees it:

- The AI is sent only the problem text and the group's theme, never the answer key.
- The rewrite must contain exactly the same numbers as the teacher's problem: none dropped, none changed, none added. An added number is also how a rewrite that gives away the answer gets caught. If a rewrite fails, Claude gets one more try. After that, the group sees the original problem.
- The original problem is always shown under the story.
- Answers are always checked against the teacher's key, Fun Mode or not.

The theme a group types is limited to 40 characters and is sent to Claude as data, not instructions. Claude is told to keep the result school-appropriate. Rewrites are cached per problem and theme, and capped at 60 per group per class. The teacher can turn Fun Mode off for a class on the setup page.

With `ANTHROPIC_API_KEY`, Fun Mode calls `claude-opus-5-5` at low effort, with server-side refusal fallback turned on (`fallbacks: "default"`), so a declined request is retried on another model instead of failing. Through Vercel AI Gateway it calls Claude Opus 5.5 at low effort, falling back to Claude Opus 5 if the gateway doesn't offer 5.5. Either way, any failure shows the group the original problem. Set `FUN_MODE_MODEL` to use a different model.

## Student data

- Groups use a class code and a group name. There are no accounts or passwords.
- Fun Mode sends only the problem text and the group's theme to Claude (through Vercel AI Gateway on the Vercel demo). Never names or answers.
- Exit tickets ask for a first name only.
- Nothing is written to disk or a database. A class is deleted when the teacher presses **Clear class data**, after 12 hours with no activity, or after 24 hours, whichever comes first. A server restart also deletes it.
- The board is protected by a long secret saved in the teacher's browser, or the 6-digit PIN for a phone. After 10 wrong PINs in 10 minutes, sign-in locks for that class.

## Decisions the plan left open

These are my calls while building. Each is easy to change after talking to Mr. A.

| Decision | Why |
|---|---|
| **Quiet** = no answer in 3 minutes. **Stuck** = 3 wrong tries in a row on one problem. The teacher can change both. | Starting points to tune in the first lesson. |
| Mr. A can **skip a problem** for a stuck group. | One wrong line in the answer key would otherwise stall a group with no way out, which is the very thing the product is meant to stop. |
| Mr. A can **open the exit ticket for everyone** at any time. Groups also reach it on their own when they finish. | The success test is finishing the lesson, exit ticket included, even on a day the group work runs long. |
| The board works on a **phone**, with a PIN. | Mr. A is walking around the room, not at his desk. |
| **Exit tickets are taken in turns** on the group's computer. | The plan has one computer per group. |
| Exit tickets don't show students their score. | So the next student in line can't see the answers. |
| **Live updates by polling** every 2 to 3 seconds, not websockets. | It works through school firewalls and proxies that often block websockets. |
| Fun Mode needs a one-tap theme choice first, and shows the original math under the story. | So the math is always visible, even if a rewrite reads oddly. |

## Before the real test

From the plan, still to do:

1. Ten minutes with Mr. A: why the class computers aren't used now, how much setup time he'd accept, and what he'd need to see to try it.
2. Which class to test with. He may not want to start with last period.
3. **Principal's permission before any student uses it.** It handles student work and first names, and Fun Mode sends problem text and the group's theme to Anthropic.
4. One of his real worksheets. Paste it into the setup page and check the preview reads it correctly.

Questions this build raised for Mr. A:

- Is 3 minutes / 3 wrong tries the right point to flag a group?
- Is it OK for students to take turns on one computer for the exit ticket, or do they have phones or more computers?
- Should students see their own exit ticket score?
- Does he want Fun Mode on for the first test, or only the board?
- Can the class computers reach the site where TwoTrack is hosted?

## Development

```sh
npm test        # parser, answer checker, Fun Mode and API tests
npm run dev     # restart on file changes
```

```
server.js              starts the HTTP server
src/app.js             routes, static files, class expiry
src/classroom.js       class and group state, flags, board and group views
src/answers.js         answer checking
src/funmode.js         Fun Mode: Claude rewrite + number check
public/lib/worksheet.js  worksheet parser (used by the setup page preview and the server)
public/*.html, public/js/  student page, teacher setup, live board, smartboard display
```

There's no build step and no framework. The dependencies are the Anthropic SDK and `@vercel/oidc` (for signing in to Vercel AI Gateway on a deployment).
