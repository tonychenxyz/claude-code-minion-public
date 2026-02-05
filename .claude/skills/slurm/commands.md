# SLURM Useful Commands

## Job Submission

### Interactive Job with salloc + srun
```bash
# Allocate GPU and run command immediately
salloc --nodes=1 --ntasks=1 --gres=gpu:1 --time=00:30:00 srun command

# With environment variables
salloc --nodes=1 --ntasks=1 --gres=gpu:1 --time=00:30:00 \
  srun --export=ALL command
```

### Background Job
```bash
# Run in background and redirect output
salloc --nodes=1 --ntasks=1 --gres=gpu:1 --time=00:30:00 \
  srun command > output.log 2>&1 &

# Get PID
echo $!
```

## Job Management

```bash
# Check job queue
squeue -u $USER

# Cancel job
scancel <job_id>

# Job details
scontrol show job <job_id>

# Node information
sinfo

# Check partition info
scontrol show partition <partition_name>
```

## Monitoring

```bash
# Watch job queue (updates every 2 seconds)
watch -n 2 squeue -u $USER

# Check specific job status
squeue -j <job_id>

# Check node status
sinfo -N -l
```

## Model Pre-download for Offline Use

```bash
# Download HuggingFace model to cache
uv run python -c "
from huggingface_hub import snapshot_download
path = snapshot_download(
    'facebook/opt-125m',
    cache_dir='/path/to/.cache/huggingface'
)
print(f'Model cached at: {path}')
"
```

## Running Python with uv in SLURM

```bash
# Basic
srun uv run python script.py

# With arguments
srun uv run python script.py --arg1 value1 --arg2 value2

# With environment variables
srun --export=ALL uv run python script.py
```

## Complete Workflow Example

```bash
# 1. Pre-download model on login node
cd /path/to/project
uv run python -c "
from huggingface_hub import snapshot_download
snapshot_download('facebook/opt-125m', cache_dir='../.cache/huggingface')
"

# 2. Set environment variables
export HF_HOME=/path/to/.cache/huggingface
export HF_DATASETS_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

# 3. Run with salloc + srun
MODEL_PATH="/path/.cache/huggingface/models--facebook--opt-125m/snapshots/<hash>"
salloc --nodes=1 --gres=gpu:1 --time=00:30:00 \
  srun --export=ALL \
  uv run python benchmark.py --model "$MODEL_PATH"
```
