# SLURM Network Access on Della

## Enabling Network Access for W&B, APIs, etc.

Compute nodes on Della have limited network access by default. To enable access to whitelisted services (W&B, OpenAI, Anthropic, Gemini), use the proxy module:

```bash
module load proxy/default
```

## Whitelisted Services
- Weights & Biases (wandb.ai)
- OpenAI API
- Anthropic API
- Google Gemini API

## Usage in SLURM Scripts

Add the proxy module after loading other modules:

```bash
#!/bin/bash
#SBATCH ...

# Setup environment
module load anaconda3/2025.12 cudatoolkit/12.8
module load proxy/default  # Enable network access for W&B and APIs
source activate my_env

# Now W&B logging will work
python train.py
```

## Notes
- This enables online logging for wandb sweeps
- Model downloads from HuggingFace still need to be done on login node (HF not whitelisted)
- Keep using `HF_HUB_OFFLINE=1` for HuggingFace operations
