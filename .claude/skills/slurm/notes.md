# SLURM Job Management Notes

## Session Termination Policy

**DO NOT automatically scancel sessions after srun commands finish!**

- Keep the session alive after srun completes - user may want to run more commands
- Only use `scancel` when user explicitly asks to cancel/end/terminate the session

## Using srun Instead of sbatch

**For testing/development: Use `srun` for interactive testing**

### salloc + srun Workflow

This is the correct approach for interactive/immediate GPU job execution:

```bash
salloc --nodes=1 --ntasks=1 --gres=gpu:1 --time=00:30:00 srun --export=ALL command
```

**How it works:**
1. `salloc` allocates resources (GPU node) and waits for them
2. Once allocated, `srun` executes the command on the allocated node
3. When command completes, allocation is automatically released

### Key Requirements for Compute Nodes

#### 1. Network Access on Compute Nodes
- Compute nodes may not have internet access (cluster-dependent)
- **Check your cluster's policy - you may need to pre-download models/data on login node**

#### 2. Pre-downloading Models for Offline Use

For HuggingFace models:
```python
from huggingface_hub import snapshot_download

# Download full model snapshot to cache
path = snapshot_download(
    'model-name',
    cache_dir='/path/to/projects/.cache/huggingface'
)
# Returns: /path/.cache/huggingface/models--org--name/snapshots/<hash>
```

#### 3. Environment Variables for Offline Mode

Must export these before running srun (if no internet on compute nodes):
```bash
export HF_HOME=/path/to/.cache/huggingface
export TRANSFORMERS_CACHE=/path/to/.cache/huggingface
export HF_DATASETS_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
```

#### 4. Using Cached Models

**IMPORTANT:** Must use the full snapshot path, not repo ID:
```bash
# This may not work on compute node (tries to access internet):
--model "facebook/opt-125m"

# This works (uses local cache):
--model "/path/.cache/huggingface/models--facebook--opt-125m/snapshots/<hash>"
```

#### 5. Passing Environment Variables to srun

Use `--export=ALL` to pass environment variables to the compute node:
```bash
srun --export=ALL command
```

### Complete Example

```bash
#!/bin/bash
# 1. Set cache location
export HF_HOME=/path/to/.cache/huggingface
export TRANSFORMERS_CACHE=/path/to/.cache/huggingface

# 2. Enable offline mode (if no internet on compute nodes)
export HF_DATASETS_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

# 3. Use local model path
MODEL_PATH="/path/.cache/huggingface/models--org--model/snapshots/<hash>"

# 4. Run with salloc + srun
salloc --nodes=1 --ntasks=1 --gres=gpu:1 --time=00:30:00 \
  srun --export=ALL \
  uv run python script.py --model "$MODEL_PATH"
```

## Common salloc Options

- `--nodes=1` - Number of nodes
- `--ntasks=1` - Number of tasks/processes
- `--gres=gpu:1` - Request 1 GPU
- `--gres=gpu:2` - Request 2 GPUs
- `--time=00:30:00` - Time limit (HH:MM:SS)
- `--partition=<name>` - Specific partition (if needed)

## Troubleshooting

### Error: "Name or service not known"
- **Cause:** Compute node trying to access internet
- **Solution:** Pre-download on login node, use local paths

### Error: "LocalEntryNotFoundError"
- **Cause:** Model not in cache or wrong cache structure
- **Solution:** Use `snapshot_download()` not just model loading

### Error: Environment variables not set
- **Cause:** Forgot `--export=ALL` with srun
- **Solution:** Add `--export=ALL` to srun command
