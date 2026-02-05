---
name: slurm
description: Manage SLURM job scheduling for interactive sessions (salloc) and batch jobs (sbatch) on HPC clusters with GPU resources
---

# SLURM Job Management Skill

This skill provides guidance for working with SLURM workload manager on HPC clusters.

## Critical Context

**You are currently on the HEAD NODE** with the following characteristics:
- Has internet access for downloading models/data
- Shared filesystem with GPU compute nodes
- No GPU access on head node
- Should not run compute-intensive tasks

**GPU compute nodes:**
- Have GPUs for training/inference
- Share filesystem with head node (all paths work)
- May have NO internet access (cluster-dependent)
- Cannot download models or datasets (if no internet)

**IMPORTANT:** Always download models, datasets, and dependencies on the head node BEFORE submitting SLURM jobs (if compute nodes lack internet).

## Resource Allocation Best Practices

### Time Allocation
- **Request only the time you need** - Shorter jobs allocate faster
- Within 24 hours, allocation time usually doesn't affect wait time significantly
- Typical values: `--time=3:00:00` (3 hours) or `--time=23:00:00` (23 hours)

### GPU Utilization Warning
**Low GPU utilization decreases your priority in SLURM for future jobs**
- Always ensure your code efficiently uses allocated GPUs
- Monitor GPU utilization with `nvidia-smi` during runs
- Avoid requesting GPUs you won't fully utilize

## Interactive Sessions (salloc)

### CRITICAL: Request salloc FIRST

**If you need an interactive GPU session, request it IMMEDIATELY as your first action!**

Node allocation can take time (minutes to hours depending on cluster load). Don't waste time by:
- Editing code first, then requesting nodes
- Setting up environment, then requesting nodes
- Downloading models, then requesting nodes

**Correct workflow:**
1. **Request salloc FIRST** - Start the allocation process immediately
2. While waiting for allocation, do other prep work:
   - Edit code
   - Download models/data (on head node)
   - Set up environment
   - Review/plan next steps
3. Once allocated, run your GPU tasks

**Why:** Getting nodes can take 5-30+ minutes. By requesting early, the allocation happens in parallel with your prep work.

### Basic Usage

```bash
# Allocate interactive session (adjust partition/resources for your cluster)
salloc --nodes=1 --gres=gpu:1 --partition=<your-partition> --time=3:00:00

# Monitor until allocated
# Wait for: "salloc: Granted job allocation XXXXX"
```

### Monitoring Allocation Status

After running `salloc`, you must **wait and monitor** until allocation is granted:

```bash
# Run salloc in background to capture output
salloc --nodes=1 --gres=gpu:1 --partition=<your-partition> --time=3:00:00 > /tmp/salloc.log 2>&1 &
SALLOC_PID=$!

# Monitor until allocated
while kill -0 $SALLOC_PID 2>/dev/null; do
    if grep -q "Granted job allocation" /tmp/salloc.log; then
        echo "Allocation granted!"
        break
    fi
    if grep -q "error" /tmp/salloc.log; then
        echo "Allocation failed!"
        cat /tmp/salloc.log
        break
    fi
    echo "Waiting for allocation..."
    sleep 5
done
```

### Using Interactive Sessions

Once allocated:

```bash
# Run commands on compute node with srun
srun hostname              # See which node you're on
srun nvidia-smi            # Check GPU availability
srun python train.py       # Run training (blocks, shows output)

# For long-running tasks, background with output redirect
srun python train.py > /tmp/train.log 2>&1 &
PID=$!

# Monitor progress
tail -f /tmp/train.log

# Check if still running
kill -0 $PID 2>/dev/null && echo "running" || echo "done"
```

### Exit Interactive Session

```bash
exit  # Releases allocation
```

### Session Termination Policy

**DO NOT automatically cancel sessions after srun commands finish!**

When an interactive `srun` command completes:
- **Keep the session alive** - User may want to run more commands
- **Report completion** - Let user know the command finished
- **DO NOT run `scancel`** - Unless user explicitly asks

**Only use `scancel` when:**
- User explicitly says to cancel/end/terminate the session
- User says they're done with the GPU
- User asks to release the allocation

## Batch Jobs (sbatch)

### Project Organization

**Directory Structure:**
```
project/
├── run_scripts/          # Store sbatch scripts here
│   ├── train.sbatch
│   └── eval.sbatch
├── slurm_outputs/        # SLURM output/error files
│   ├── 12345.out
│   └── 12345.err
├── src/                  # Your code
└── data/                 # Your data
```

**Naming Conventions:**
- **Sbatch scripts:** Descriptive names indicating purpose
  - `train_2gpu.sbatch` - Training with 2 GPUs
  - `eval.sbatch` - Evaluation
- **Output files:** Use `%j` in path for automatic job ID
  - `--output=slurm_outputs/%j.out` -> `slurm_outputs/12345.out`
  - `--error=slurm_outputs/%j.err` -> `slurm_outputs/12345.err`

### Example Sbatch Script

```bash
#!/bin/bash
#SBATCH --job-name=train
#SBATCH --partition=<your-partition>    # Your cluster's GPU partition
#SBATCH --gres=gpu:1                    # Number of GPUs
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=128G
#SBATCH --time=3:00:00
#SBATCH --output=slurm_outputs/%j.out
#SBATCH --error=slurm_outputs/%j.err

# Set cache directories to avoid $HOME quota issues
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$SLURM_TMPDIR/.cache}"
export VLLM_CACHE_ROOT="${VLLM_CACHE_ROOT:-$XDG_CACHE_HOME/vllm}"
export TORCHINDUCTOR_CACHE_DIR="${TORCHINDUCTOR_CACHE_DIR:-$XDG_CACHE_HOME/torchinductor}"
export TRITON_CACHE_DIR="${TRITON_CACHE_DIR:-$XDG_CACHE_HOME/triton}"
mkdir -p "$VLLM_CACHE_ROOT" "$TORCHINDUCTOR_CACHE_DIR" "$TRITON_CACHE_DIR"

# Run job
cd /path/to/project
python train.py
```

### Submit and Monitor

```bash
# Submit job
sbatch job.sbatch
# Output: Submitted batch job XXXXX

# Check status
squeue -u $USER

# View output (updates in real-time)
tail -f slurm_outputs/XXXXX.out

# Cancel job if needed
scancel XXXXX
```

## Common Commands

```bash
# Check your queued/running jobs
squeue -u $USER

# Check partition availability
sinfo -p <partition-name>

# View job details
scontrol show job JOBID

# Cancel job
scancel JOBID

# Cancel all your jobs
scancel -u $USER
```

## Pre-download Checklist

Before submitting SLURM jobs (if compute nodes lack internet), ensure you've downloaded on HEAD NODE:

- [ ] Hugging Face models (`transformers`, `datasets`)
- [ ] PyTorch models (`torch.hub`)
- [ ] Custom model weights
- [ ] Datasets and data files
- [ ] Python packages (if not in shared env)

**Example: Pre-download HF model**
```bash
# On head node (where you have internet)
python -c "
from transformers import AutoModel, AutoTokenizer
model = AutoModel.from_pretrained('bert-base-uncased', cache_dir='<working-dir>/projects/.cache/huggingface')
tokenizer = AutoTokenizer.from_pretrained('bert-base-uncased', cache_dir='<working-dir>/projects/.cache/huggingface')
print('Model downloaded successfully!')
"
```

## Troubleshooting

### Job stuck in queue
- Check partition availability: `sinfo -p <partition>`
- Try shorter time allocation: `--time=3:00:00` instead of `--time=23:00:00`
- Check your priority: Low GPU utilization in past jobs lowers future priority

### Job fails immediately
- Check output: `cat slurm_outputs/JOBID.err`
- Verify paths exist and are accessible
- Ensure models/data downloaded on head node first

### Out of memory
- Increase `--mem=` value
- Reduce batch size in code
- Use fewer GPUs if not needed

### Cannot download model/data in job
- GPU nodes may have NO internet access
- Download everything on head node BEFORE submitting job
- Use shared cache: `projects/.cache/huggingface/`

## Example Workflows

### Interactive Development
```bash
# 1. Download model on head node (you are here)
python download_model.py

# 2. Allocate interactive GPU
salloc --nodes=1 --gres=gpu:1 --partition=<your-partition> --time=2:00:00

# 3. Test code interactively
srun python test_training.py

# 4. Exit when done
exit
```

### Production Training
```bash
# 1. Download everything on head node
python download_model.py
python download_data.py

# 2. Create sbatch script
cat > train.sbatch << 'EOF'
#!/bin/bash
#SBATCH --job-name=train
#SBATCH --partition=<your-partition>
#SBATCH --gres=gpu:1
#SBATCH --time=23:00:00
#SBATCH --output=slurm_outputs/%j.out

cd /path/to/project
python train.py
EOF

# 3. Submit job
sbatch train.sbatch

# 4. Monitor
tail -f slurm_outputs/*.out
```

## Key Reminders

1. **You are on HEAD NODE** - use for downloads, preparation, monitoring
2. **GPU nodes may have NO internet** - download everything first
3. **Request appropriate time** - don't over-allocate
4. **Maintain high GPU utilization** - affects future job priority
5. **Monitor salloc allocation** - wait until "Granted" before proceeding
6. **Use shared cache** - `projects/.cache/` for models and datasets
7. **srun is synchronous** - outputs to terminal, blocks until complete
8. **Background long srun jobs** - redirect output, monitor logs
