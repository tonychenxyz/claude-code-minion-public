---
name: slurm
description: Manage SLURM job scheduling for interactive sessions (salloc) and batch jobs (sbatch) on HPC clusters with GPU resources
---

# SLURM Job Management Skill

This skill provides guidance for working with SLURM workload manager on the HPC cluster.

## Critical Context

**You are currently on the HEAD NODE** with the following characteristics:
- ✅ Has internet access for downloading models/data
- ✅ Shared filesystem with GPU compute nodes
- ❌ No GPU access on head node
- ❌ Should not run compute-intensive tasks

**GPU compute nodes:**
- ✅ Have GPUs for training/inference
- ✅ Share filesystem with head node (all paths work)
- ❌ NO internet access
- ❌ Cannot download models or datasets

**IMPORTANT:** Always download models, datasets, and dependencies on the head node BEFORE submitting SLURM jobs.

## Default Partition: ailab

**Always use `ailab` unless the user specifically requests a different partition.**

### ailab partition (DEFAULT)
- **GPUs:** H200 (newest, most powerful)
- **Partition:** `--partition=ailab`
- **Use case:** All GPU workloads (default choice)
- **Note:** No constraint needed, GPUs auto-assigned

## Alternative Partitions (use only when specified)

### pli partition
- **GPUs:** A100 80GB (gpu80)
- **Constraint:** `--constraint=gpu80`
- **Partition:** `--partition=pli`
- **Account:** `--account=llm_explore`
- **Use case:** Large models, high memory requirements
- **When to use:** Only if user explicitly requests pli or A100 80GB

### gpu partition
- **GPUs:** A100 40GB (gpu40)
- **Constraint:** `--constraint=gpu40`
- **Partition:** `--partition=gpu`
- **Use case:** Medium models, standard training
- **When to use:** Only if user explicitly requests gpu partition or A100 40GB

## Resource Allocation Best Practices

### Time Allocation
- **Request only the time you need** - Shorter jobs allocate faster
- Within 24 hours, allocation time usually doesn't affect wait time significantly
- Typical values: `--time=3:00:00` (3 hours) or `--time=23:00:00` (23 hours)

### GPU Utilization Warning
⚠️ **Low GPU utilization decreases your priority in SLURM for future jobs**
- Always ensure your code efficiently uses allocated GPUs
- Monitor GPU utilization with `nvidia-smi` during runs
- Avoid requesting GPUs you won't fully utilize

## Interactive Sessions (salloc)

### ⚠️ CRITICAL: Request salloc FIRST

**If you need an interactive GPU session, request it IMMEDIATELY as your first action!**

Node allocation can take time (minutes to hours depending on cluster load). Don't waste time by:
- ❌ Editing code first, then requesting nodes
- ❌ Setting up environment, then requesting nodes
- ❌ Downloading models, then requesting nodes

**Correct workflow:**
1. ✅ **Request salloc FIRST** - Start the allocation process immediately
2. ✅ While waiting for allocation, do other prep work:
   - Edit code
   - Download models/data (on head node)
   - Set up environment
   - Review/plan next steps
3. ✅ Once allocated, run your GPU tasks

**Why:** Getting nodes can take 5-30+ minutes. By requesting early, the allocation happens in parallel with your prep work. This saves significant time.

### Basic Usage

```bash
# Allocate interactive session
salloc --nodes=1 --gres=gpu:1 --partition=ailab --time=3:00:00

# Monitor until allocated
# Wait for: "salloc: Granted job allocation XXXXX"
```

### Monitoring Allocation Status

After running `salloc`, you must **wait and monitor** until allocation is granted:

```bash
# Run salloc in background to capture output
salloc --nodes=1 --gres=gpu:1 --partition=ailab --time=3:00:00 > /tmp/salloc.log 2>&1 &
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

### Maintaining GPU Utilization During Idle Time

**CRITICAL:** Low GPU utilization decreases your SLURM priority for future jobs.

When you finish a task in an interactive session and are **waiting** for the next instruction:

```bash
# Start keep_it_on.py to maintain GPU utilization
srun python /scratch/gpfs/ZHUANGL/hc5019/keep_it_on.py > /tmp/keep_it_on.log 2>&1 &
KEEP_IT_ON_PID=$!

# Save the PID for later
echo $KEEP_IT_ON_PID > /tmp/keep_it_on.pid

# Verify it's running
ps -p $KEEP_IT_ON_PID
```

**What keep_it_on.py does:**
- Runs continuous vLLM inference on all allocated GPUs
- Keeps GPU utilization high (prevents priority penalty)
- Uses dummy prompts in an infinite loop
- Automatically detects and uses all available GPUs

**When to use:**
- ✅ After finishing a training run, waiting for next instruction
- ✅ During idle periods in interactive sessions
- ✅ Between experiments when deciding what to run next
- ❌ Don't use when actively running your own GPU workload

**When to kill it:**

Before running your next task, kill the keep_it_on process using nvidia-smi:

```bash
# Check GPU processes
srun nvidia-smi

# Find Python processes using GPUs (look for keep_it_on.py or python processes)
# Note the PID(s) from the output

# Kill the process(es) forcefully
srun kill -9 <PID>

# Verify GPUs are free
srun nvidia-smi

# Alternative: If you saved the PID earlier
# kill -9 $(cat /tmp/keep_it_on.pid)

# Now run your next task
srun python your_next_script.py
```

**Workflow example:**
```bash
# 1. Run training
srun python train.py > /tmp/train.log 2>&1 &
TRAIN_PID=$!

# 2. Monitor until complete
tail -f /tmp/train.log
# ... training finishes ...

# 3. Start keep_it_on immediately
srun python /scratch/gpfs/ZHUANGL/hc5019/keep_it_on.py > /tmp/keep_it_on.log 2>&1 &
echo $! > /tmp/keep_it_on.pid

# 4. Wait for user's next instruction
# ... user thinks about next steps ...

# 5. When ready for next task, kill keep_it_on
srun nvidia-smi  # Find the Python process PID
srun kill -9 <PID_from_nvidia_smi>

# 6. Verify GPUs are free
srun nvidia-smi

# 7. Run next task
srun python evaluate.py
```

### Exit Interactive Session

```bash
exit  # Releases allocation
```

### Session Termination Policy

**⚠️ DO NOT automatically cancel sessions after srun commands finish!**

When an interactive `srun` command completes:
- ✅ **Keep the session alive** - User may want to run more commands
- ✅ **Start keep_it_on.py** - Maintain GPU utilization while waiting
- ✅ **Report completion** - Let user know the command finished
- ❌ **DO NOT run `scancel`** - Unless user explicitly asks

**Only use `scancel` when:**
- User explicitly says to cancel/end/terminate the session
- User says they're done with the GPU
- User asks to release the allocation

**Example - CORRECT behavior:**
```bash
# User asks: "run my training script"
srun python train.py
# Training finishes...
# Report: "✅ Training complete"
# Start keep_it_on.py
# DO NOT scancel - wait for user's next instruction
```

**Example - When to scancel:**
```bash
# User says: "cancel my job" or "release the GPU" or "I'm done"
scancel <job_id>
# Report: "✅ Session cancelled, GPU released"
```

## Batch Jobs (sbatch)

### Project Organization

**Directory Structure:**
```
project/
├── run_scripts/          # Store sbatch scripts here
│   ├── train_pli.sbatch
│   ├── train_ailab.sbatch
│   └── eval.sbatch
├── slurm_outputs/        # SLURM output/error files
│   ├── 12345.out
│   └── 12345.err
├── src/                  # Your code
└── data/                 # Your data
```

**Naming Conventions:**
- **Sbatch scripts:** Descriptive names indicating purpose and partition
  - `train_pli_2gpu.sbatch` - Training on pli with 2 GPUs
  - `eval_ailab.sbatch` - Evaluation on ailab
  - `finetune_h200.sbatch` - Finetuning on H200
- **Output files:** Use `%j` in path for automatic job ID
  - `--output=slurm_outputs/%j.out` → `slurm_outputs/12345.out`
  - `--error=slurm_outputs/%j.err` → `slurm_outputs/12345.err`

**Configuration Locations in Sbatch Script:**

```bash
#!/bin/bash
# ============ SLURM DIRECTIVES (lines starting with #SBATCH) ============
#SBATCH --job-name=train           # Job name (shows in squeue)
#SBATCH --partition=pli            # Which partition to use
#SBATCH --constraint=gpu80         # GPU type constraint (if needed)
#SBATCH --gres=gpu:2               # Number of GPUs
#SBATCH --nodes=1                  # Number of nodes
#SBATCH --ntasks-per-node=1        # Tasks per node
#SBATCH --cpus-per-task=4          # CPU cores per task
#SBATCH --mem=128G                 # Memory allocation
#SBATCH --account=llm_explore      # Account (for pli partition)
#SBATCH --time=23:00:00            # Time limit (HH:MM:SS)
#SBATCH --output=slurm_outputs/%j.out   # stdout file (%j = job ID)
#SBATCH --error=slurm_outputs/%j.err    # stderr file (%j = job ID)

# ============ ENVIRONMENT SETUP ============
# Set cache directories, load modules, activate environments

# ============ YOUR CODE ============
# cd to project directory and run your script
```

**Where to Store:**
- **Sbatch scripts:** `run_scripts/` or project root
- **Output files:** `slurm_outputs/` (automatically created by SLURM)
- **Create directories:** `mkdir -p run_scripts slurm_outputs` before first use

### Workflow

1. **Download dependencies on head node FIRST**
2. **Create sbatch script in run_scripts/**
3. **Ensure slurm_outputs/ directory exists**
4. **Submit job**
5. **Monitor job status**

### Example: ailab partition (H200) - DEFAULT

**Use this template for all batch jobs unless a different partition is specified.**

```bash
#!/bin/bash
#SBATCH --job-name=h200_train
#SBATCH --partition=ailab
#SBATCH --gres=gpu:1
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=128G
#SBATCH --time=3:00:00
#SBATCH --output=slurm_outputs/%j.out
#SBATCH --error=slurm_outputs/%j.err

# Avoid $HOME quota issues
CACHE_ROOT="${XDG_CACHE_HOME:-${SLURM_TMPDIR:-/scratch/gpfs/ZHUANGL/hc5019/.cache}}"
export XDG_CACHE_HOME="$CACHE_ROOT"
export VLLM_CACHE_ROOT="${VLLM_CACHE_ROOT:-$XDG_CACHE_HOME/vllm}"
export TORCHINDUCTOR_CACHE_DIR="${TORCHINDUCTOR_CACHE_DIR:-$XDG_CACHE_HOME/torchinductor}"
export TRITON_CACHE_DIR="${TRITON_CACHE_DIR:-$XDG_CACHE_HOME/triton}"
mkdir -p "$VLLM_CACHE_ROOT" "$TORCHINDUCTOR_CACHE_DIR" "$TRITON_CACHE_DIR"

# Run job
cd /path/to/project
python train.py
```

### Example: pli partition (A100 80GB) - ALTERNATIVE

**Only use when user specifically requests pli partition or A100 80GB GPUs.**

```bash
#!/bin/bash
#SBATCH --job-name=train_model
#SBATCH --partition=pli
#SBATCH --constraint=gpu80
#SBATCH --gres=gpu:2              # 2 GPUs
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=128G
#SBATCH --account=llm_explore
#SBATCH --time=23:00:00
#SBATCH --output=slurm_outputs/%j.out
#SBATCH --error=slurm_outputs/%j.err

# Avoid $HOME quota issues from caches
CACHE_ROOT="${XDG_CACHE_HOME:-${SLURM_TMPDIR:-/scratch/gpfs/ZHUANGL/hc5019/.cache}}"
export XDG_CACHE_HOME="$CACHE_ROOT"
export VLLM_CACHE_ROOT="${VLLM_CACHE_ROOT:-$XDG_CACHE_HOME/vllm}"
export TORCHINDUCTOR_CACHE_DIR="${TORCHINDUCTOR_CACHE_DIR:-$XDG_CACHE_HOME/torchinductor}"
export TRITON_CACHE_DIR="${TRITON_CACHE_DIR:-$XDG_CACHE_HOME/triton}"
mkdir -p "$VLLM_CACHE_ROOT" "$TORCHINDUCTOR_CACHE_DIR" "$TRITON_CACHE_DIR"

# Run training
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
sinfo -p pli
sinfo -p gpu
sinfo -p ailab

# View job details
scontrol show job JOBID

# Cancel job
scancel JOBID

# Cancel all your jobs
scancel -u $USER
```

## Pre-download Checklist

Before submitting SLURM jobs, ensure you've downloaded on HEAD NODE:

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
model = AutoModel.from_pretrained('bert-base-uncased', cache_dir='/scratch/gpfs/ZHUANGL/hc5019/claude_code_workspace/claude-code-minion/projects/.cache/huggingface')
tokenizer = AutoTokenizer.from_pretrained('bert-base-uncased', cache_dir='/scratch/gpfs/ZHUANGL/hc5019/claude_code_workspace/claude-code-minion/projects/.cache/huggingface')
print('Model downloaded successfully!')
"
```

## Troubleshooting

### Job stuck in queue
- Check partition availability: `sinfo -p PARTITION`
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
- ❌ GPU nodes have NO internet access
- ✅ Download everything on head node BEFORE submitting job
- ✅ Use shared cache: `projects/.cache/huggingface/`

## Example Workflows

### Interactive Development
```bash
# 1. Download model on head node (you are here)
python download_model.py

# 2. Allocate interactive GPU
salloc --nodes=1 --gres=gpu:1 --partition=ailab --time=2:00:00

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
#SBATCH --partition=ailab
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
2. **GPU nodes have NO internet** - download everything first
3. **Request appropriate time** - don't over-allocate
4. **Maintain high GPU utilization** - affects future job priority
5. **Monitor salloc allocation** - wait until "Granted" before proceeding
6. **Use shared cache** - `projects/.cache/` for models and datasets
7. **srun is synchronous** - outputs to terminal, blocks until complete
8. **Background long srun jobs** - redirect output, monitor logs
