---
name: seashells
description: Stream terminal output to a live web URL using seashells.io for real-time monitoring of long-running commands
---

# Seashells Live Terminal Streaming

Seashells.io pipes terminal output to a web URL in real-time. Use this for long-running jobs so the user can watch live output.

## When to Use

- Long-running training jobs (> 5 minutes)
- SLURM jobs with lots of output
- Any command where periodic summaries aren't enough
- When user explicitly asks for live terminal view

## Quick Reference

```bash
# STANDARD PATTERN - use this for most commands:
stdbuf -oL command 2>&1 | tee /tmp/output.log | seashells &

# For Python scripts - add -u for unbuffered:
stdbuf -oL python -u script.py 2>&1 | tee /tmp/output.log | seashells &

# For Python with venv:
stdbuf -oL .venv/bin/python -u script.py 2>&1 | tee /tmp/output.log | seashells &

# For SLURM srun:
stdbuf -oL srun python -u train.py 2>&1 | tee /tmp/train.log | seashells &
```

## Component Breakdown

| Component | Purpose |
|-----------|---------|
| `stdbuf -oL` | Force line buffering (real-time output) |
| `python -u` | Python unbuffered mode (essential!) |
| `2>&1` | Capture both stdout and stderr |
| `tee /tmp/file.log` | Save locally AND pass to seashells |
| `seashells` | Stream to web URL |
| `&` | Run in background |

## Workflow

1. **Start the command:**
   ```bash
   stdbuf -oL .venv/bin/python -u script.py 2>&1 | tee /tmp/output.log | seashells &
   ```

2. **Wait and get the URL:**
   ```bash
   sleep 5 && head -30 /tmp/output.log
   ```
   Look for: `serving at https://seashells.io/v/XXXXXX`

3. **Send URL to user:**
   ```
   🔗 *Live terminal output:* https://seashells.io/v/XXXXXX
   ```

4. **Monitor locally:**
   ```bash
   tail -50 /tmp/output.log
   ```

## Important Notes

### Buffering is Critical
- Without `stdbuf -oL`: Output delayed or missing
- Without `python -u`: Python buffers stdout
- Both are needed for real-time streaming

### URL Location
- The seashells URL may NOT be the first line
- It appears after the pipe is established
- Check `head -30` of the log to find it

### Output Duplication
- You may see duplicated lines in the log
- This is cosmetic due to buffering timing
- The seashells stream is correct

### Not Available: `unbuffer`
- `unbuffer` command is NOT installed on this system
- Use `stdbuf -oL` instead (same effect)

## Limitations

- Sessions expire after ~1 day
- Max 5 concurrent sessions per IP
- Beta service - not for critical monitoring
- Some initial output may be lost before URL is generated

## Troubleshooting

**Problem:** No URL appears
**Solution:** Wait longer (up to 10 seconds), check `head -50` of log

**Problem:** Output is delayed
**Solution:** Ensure `stdbuf -oL` is used, and `-u` for Python

**Problem:** Process dies silently
**Solution:** Check log file for errors: `tail -100 /tmp/output.log`

**Problem:** Need to stop the background job
**Solution:** Find PID with `ps aux | grep seashells` and `kill <PID>`
