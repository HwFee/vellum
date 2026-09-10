@echo off
REM Markdown commit-cost benchmarks (one-shot runner for background tasks).
REM Comments are ASCII-only on purpose: cmd.exe reads this file in the OEM
REM codepage, so non-ASCII text here breaks parsing on some machines.
REM
REM usage: scripts\run-bench.cmd
REM        set BENCH_BIG=1 before calling it to add the 2MB / 1.5MB cases.
cd /d "%~dp0.."

echo === PASS 1: pipeline (V8, renderToStaticMarkup) ===
call npx vitest bench --run scripts/bench-markdown-pipeline.bench.tsx
echo PASS1_EXIT=%ERRORLEVEL%

echo === PASS 2: jsdom commit (upper bound) ===
call npx vitest bench --run scripts/bench-markdown-commit.bench.tsx
echo PASS2_EXIT=%ERRORLEVEL%
