# TwoTrack MVP Plan

**Founder:** David Sequira
**Built from:** my Business Model Canvas and my Ideal Customer Profile (Mr. A, the last-period Algebra teacher)

## The problem this MVP solves

Mr. A's class falls apart during group work. He walks around checking which group finished which part of the worksheet, and whichever group is behind his back goes off task. When that happens, the lesson stops and he skips to the exit ticket, so he never finishes the whole lesson.

## Product type: a simple web app

It runs in a browser on the class computers, so nothing needs to be installed. It has two screens: a live board for Mr. A, and a worksheet screen for each group. A chatbot or a quiz would only help the students. Mr. A's real problem is that he can't see the whole room at once.

## 1. The one core job

**During group work, show Mr. A every group's progress on one screen, so he can finish the whole lesson.**

Fun Mode is there to keep bored groups working, but the core job is the teacher being able to see the room.

## 2. What goes in and what comes back

### Mr. A puts in
- His worksheet, pasted as text: each activity, its problems, and the answer key
- The exit ticket problems and answers
- How many groups are in the class

### Mr. A gets back
- A class code to put on the smartboard
- A live board with one row per group, showing:
  - which activity they're on
  - how many problems they've finished
  - how long since their last answer
  - a flag when a group has gone quiet for too long or keeps getting the same problem wrong
- At the end, each student's exit ticket score

### Each group puts in
- The class code and their group name
- Their answers, typed together on one computer
- For Fun Mode: one thing the group is into (a sport, a game, music)

### Each group gets back
- One problem at a time, checked right or wrong immediately
- A **Fun Mode** button that rewrites the problem around what the group is into, keeping the same numbers and the same answer
- The next activity unlocks when they finish the current one
- At the exit ticket, each student switches to answering on their own

### One rule that makes it trustworthy
The AI only rewrites the wording for Fun Mode. **The numbers and the correct answers always come from Mr. A's own answer key**, so the AI can't teach the wrong math or mark a right answer wrong.

## 3. What to leave out for now

| Left out | Why it waits |
|---|---|
| Spanish | Next on the list for version 2. It's Mr. A's second-biggest pain. |
| AI hints for stuck groups | For now, the flag on Mr. A's board sends him to the group instead. |
| The AI writing whole lessons | Mr. A's own worksheet is the lesson. |
| A separate Straight-Up Mode | His original worksheet problem already is the straight-to-the-point version. |
| The personal home app, Free and Premium | The classroom has to work first. |
| Payments and school pricing | The first test is free. |
| Student accounts and passwords | Groups use a class code and a group name only. |
| Saving student data after class | First names on exit tickets only, and results are cleared once Mr. A has them. |
| Other subjects and other teachers | One teacher, one Algebra class. |

## 4. How I'll know it works

**The test:** Mr. A runs one real lesson with his own worksheet in one class, using TwoTrack for the group work.

**It works if:** he finishes the whole lesson, exit ticket included, in a class where he usually doesn't.

Afterward, I ask him one question: *"Would you use this again next week?"* A yes is my first real customer.

## Before I build

1. Ask Mr. A for 10 minutes after school and ask him:
   - Why don't you use the class computers now?
   - How much setup time before class would you accept?
   - What would you need to see to try this with one class?
2. Ask him which class to test with. He may not want to start with last period.
3. Get permission from the principal before any student uses it, since it involves student work and names.
4. Get one of his real worksheets so the first version is built around it.
