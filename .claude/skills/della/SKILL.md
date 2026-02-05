---
name: della-cluster
description: Run GPU jobs on Princeton's Della HPC cluster using SLURM - A100, H100, MIG partitions
---

# Della Cluster - SLURM Job Submission

Princeton's Della cluster provides A100 (40GB/80GB), H100, and MIG GPUs for compute workloads.

## Quick Reference

### GPU Partitions

| GPUs | Memory | Constraint | Use Case |
|------|--------|------------|----------|
| MIG | 10GB | `--partition=mig` | Light tasks, interactive work |
| A100 | 40GB | `--constraint=gpu40` | Standard ML training |
| A100 | 80GB | `--constraint=gpu80` | Large models needing more VRAM |
| H100 | 80GB | `--partition=pli` | Highest performance (requires PLI access) |

**Rule:** Always use the smallest GPU that meets your needs. Overprovisioning hurts fairshare priority.

### Basic Batch Job Template

```bash
#!/bin/bash
#SBATCH --job-name=my_job
#SBATCH --partition=gpu
#SBATCH --constraint=gpu80          # or gpu40 for 40GB
#SBATCH --gres=gpu:1                # Number of GPUs
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=32G
#SBATCH --time=24:00:00             # Shorter = higher QOS priority
#SBATCH --output=%x_%j.out

# Commands here
python train.py
```

### QOS Priority (shorter = higher priority)

| QOS | Max Time | Priority Boost |
|-----|----------|----------------|
| `gpu-test` | 61 min | Highest (0.40) |
| `gpu-short` | 24 hours | High (0.25) |
| `gpu-medium` | 72 hours | Medium (0.10) |
| `gpu-long` | 144 hours | Low (0.05) |

**Tip:** Use `--qos=gpu-short` with checkpointing for better queue times.

### Interactive Session

```bash
# Request interactive GPU session
salloc --partition=gpu --constraint=gpu80 --gres=gpu:1 --time=2:00:00 --mem=32G

# Then run commands with srun
srun python script.py

# Or get a shell
srun --pty bash
```

### MIG GPUs (Best for Light Tasks)

For single-GPU jobs with <10GB VRAM needs:

```bash
#SBATCH --partition=mig
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
# Memory fixed at 32GB, GPU memory at 10GB
```

Or interactively:
```bash
salloc --partition=mig --gres=gpu:1 --time=1:00:00
```

## Essential Commands

```bash
# Check queue status
squeue --me                         # Your jobs
squeue -p gpu                       # All GPU jobs

# Job information
scontrol show job <JobID>           # Detailed job info
sacct -j <JobID>                    # Job accounting
jobstats <JobID>                    # Resource utilization (IMPORTANT!)

# Node availability
shownodes                           # All nodes
shownodes -p gpu                    # GPU nodes
shownodes -p mig                    # MIG nodes

# Priority info
sprio -l -j <JobID>                 # Your job's priority breakdown
sshare -lA zhuangl                  # Fairshare status

# Cancel job
scancel <JobID>

# Storage
checkquota                          # Check disk usage
```

## Storage Locations

| Path | Size | Use For |
|------|------|---------|
| `/home/<NetID>` | 50GB | Code, conda envs (backed up) |
| `/scratch/gpfs/<NetID>` | 1TB | Job data, large files (NOT backed up) |
| `/scratch/gpfs/ZHUANGL/<NetID>` | 15TB shared | Lab shared storage |

**Important:**
- Download data from visualization nodes (`della-vis1/2`), not login or compute nodes
- Compute nodes have NO internet access

## Priority System

Your job priority = Age + Fairshare + JobSize + QOS

**To maximize priority:**
1. Use shorter time limits (`gpu-short` over `gpu-medium`)
2. Don't over-request resources (check with `jobstats`)
3. Use MIG when possible
4. Request only the GPU memory you need (gpu40 vs gpu80)

## Connection

```bash
# SSH to login node
ssh <NetID>@della.princeton.edu

# SSH to GPU login node
ssh <NetID>@della-gpu.princeton.edu

# Visualization nodes (for data download, internet access)
ssh <NetID>@della-vis1.princeton.edu
ssh <NetID>@della-vis2.princeton.edu
```

VPN required off-campus: GlobalProtect VPN at vpn.princeton.edu

## Common Issues

### "constraint=gpu40 gives different configs"
Use `--constraint=nomig` for consistent GPU configurations.

### Job stuck pending
1. Check `squeue --me` for reason code
2. Check `sprio -l -j <JobID>` for priority
3. Consider shorter time limit or fewer resources
4. Check `shownodes -p gpu` for availability

### Need to download models/data
Use visualization nodes (`della-vis1/2`) - compute nodes have no internet.

## References

- Official docs: https://researchcomputing.princeton.edu/systems/della
- MyDella portal: https://mydella.princeton.edu
- SLURM guide: https://researchcomputing.princeton.edu/support/knowledge-base/slurm
- Contact: cses@princeton.edu for system issues
