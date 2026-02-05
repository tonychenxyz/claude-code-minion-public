---
name: modal
description: Run GPU workloads on Modal serverless cloud - training, inference, batch jobs
---

# Modal Serverless GPU Cloud

Modal is a serverless cloud platform for running GPU workloads with Python. Everything is defined in code - no Docker, Kubernetes, or infrastructure config needed.

## Quick Start

### Installation

```bash
pip install modal
modal setup  # Authenticate (opens browser)
```

### Basic Example

```python
import modal

app = modal.App("my-app")

# Define container image
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch",
    "transformers",
)

@app.function(gpu="A100", image=image, timeout=3600)
def train_model(data):
    import torch
    # Your training code here
    return result

# Run locally
if __name__ == "__main__":
    with app.run():
        result = train_model.remote(data)
```

### Run Commands

```bash
modal run script.py           # Run the script
modal deploy script.py        # Deploy as persistent service
modal shell script.py         # Interactive shell in container
```

## GPU Configuration

### Available GPUs

| GPU | VRAM | Use Case | Cost (~) |
|-----|------|----------|----------|
| T4 | 16GB | Inference, small models | $0.59/hr |
| L4 | 24GB | Inference, medium models | ~$0.80/hr |
| A10G | 24GB | Training, inference | ~$1.10/hr |
| L40S | 48GB | Training, inference | ~$1.50/hr |
| A100-40GB | 40GB | Large model training | ~$2.50/hr |
| A100-80GB | 80GB | Very large models | ~$3.50/hr |
| H100 | 80GB | Fastest training | ~$4.00/hr |

### GPU Syntax

```python
# Single GPU
@app.function(gpu="A100")

# Specific memory
@app.function(gpu="A100-80GB")

# Multiple GPUs (up to 8)
@app.function(gpu="H100:4")

# Fallback list (tries in order)
@app.function(gpu=["H100", "A100-80GB", "A100-40GB"])

# Prevent auto-upgrade
@app.function(gpu="H100!")  # Won't upgrade to H200
```

## Container Images

### Base Images

```python
# Debian slim (default, recommended)
image = modal.Image.debian_slim(python_version="3.11")

# With CUDA
image = modal.Image.from_registry("nvidia/cuda:12.1.0-devel-ubuntu22.04")

# Micromamba (for conda packages)
image = modal.Image.micromamba(python_version="3.11")
```

### Installing Packages

```python
image = (
    modal.Image.debian_slim(python_version="3.11")
    # Python packages (uv is faster)
    .pip_install("torch", "transformers", "accelerate")
    # Or with uv (recommended)
    .uv_pip_install("torch", "transformers")
    # System packages
    .apt_install("git", "wget")
    # Run commands
    .run_commands("echo 'Setup complete'")
)
```

### Custom Dockerfile

```python
image = modal.Image.from_dockerfile("./Dockerfile")
```

## Volumes and Storage

### Persistent Volumes

```python
# Create a volume for model weights
volume = modal.Volume.from_name("my-models", create_if_missing=True)

@app.function(
    gpu="A100",
    volumes={"/models": volume},
)
def use_model():
    # Access files at /models
    model = load_model("/models/checkpoint.pt")
```

### CloudBucketMount (for large datasets)

```python
# Mount S3/GCS bucket
bucket = modal.CloudBucketMount(
    bucket_name="my-bucket",
    secret=modal.Secret.from_name("aws-secret"),
)

@app.function(volumes={"/data": bucket})
def process_data():
    # Access bucket at /data
    pass
```

## Secrets Management

```python
# Create secret via CLI
# modal secret create my-secret KEY=value

# Use in function
@app.function(secrets=[modal.Secret.from_name("my-secret")])
def use_secret():
    import os
    key = os.environ["KEY"]
```

## Parallel Execution

### Map Over Inputs

```python
@app.function(gpu="A100")
def process_item(item):
    return result

@app.local_entrypoint()
def main():
    items = [1, 2, 3, 4, 5]
    # Process all items in parallel
    results = list(process_item.map(items))
```

### Starmap for Multiple Args

```python
@app.function(gpu="A100")
def train(lr, batch_size):
    return accuracy

@app.local_entrypoint()
def main():
    configs = [(0.001, 32), (0.01, 64), (0.1, 128)]
    results = list(train.starmap(configs))
```

## Long-Running Jobs

### Timeouts and Retries

```python
@app.function(
    gpu="A100",
    timeout=86400,  # 24 hours max
    retries=3,      # Retry on failure
)
def long_training():
    pass
```

### Checkpointing for Resumable Training

```python
volume = modal.Volume.from_name("checkpoints", create_if_missing=True)

@app.function(
    gpu="A100",
    volumes={"/checkpoints": volume},
    timeout=3600,
)
def train_with_checkpoints(resume_from=None):
    # Load checkpoint if resuming
    if resume_from:
        model.load_state_dict(torch.load(f"/checkpoints/{resume_from}"))

    # Training loop with periodic saves
    for epoch in range(epochs):
        train_epoch()
        torch.save(model.state_dict(), f"/checkpoints/epoch_{epoch}.pt")
        volume.commit()  # Persist to cloud
```

## Common Patterns

### Fine-tuning LLMs

```python
import modal

app = modal.App("llm-finetune")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "transformers",
        "peft",
        "datasets",
        "accelerate",
        "bitsandbytes",
    )
)

volume = modal.Volume.from_name("llm-checkpoints", create_if_missing=True)

@app.function(
    gpu="A100-80GB",
    image=image,
    volumes={"/checkpoints": volume},
    timeout=7200,
)
def finetune(model_name: str, dataset_name: str, output_dir: str):
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer
    from peft import LoraConfig, get_peft_model

    # Load model and tokenizer
    model = AutoModelForCausalLM.from_pretrained(model_name, torch_dtype="auto")
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    # Apply LoRA
    lora_config = LoraConfig(r=64, lora_alpha=128, target_modules=["q_proj", "v_proj"])
    model = get_peft_model(model, lora_config)

    # Train
    trainer = Trainer(model=model, ...)
    trainer.train()

    # Save
    model.save_pretrained(f"/checkpoints/{output_dir}")
    volume.commit()
```

### Batch Inference

```python
@app.function(gpu="A100", concurrency_limit=10)
def batch_inference(prompts: list[str]) -> list[str]:
    from vllm import LLM
    llm = LLM(model="meta-llama/Llama-2-7b-hf")
    outputs = llm.generate(prompts)
    return [o.outputs[0].text for o in outputs]

@app.local_entrypoint()
def main():
    all_prompts = [...]  # 1000 prompts
    # Process in batches of 100, 10 containers in parallel
    batches = [all_prompts[i:i+100] for i in range(0, len(all_prompts), 100)]
    results = list(batch_inference.map(batches))
```

### Hyperparameter Sweep

```python
@app.function(gpu="A100")
def train_with_config(config: dict) -> dict:
    lr, batch_size, epochs = config["lr"], config["batch_size"], config["epochs"]
    # Train and return metrics
    return {"config": config, "accuracy": accuracy}

@app.local_entrypoint()
def sweep():
    configs = [
        {"lr": lr, "batch_size": bs, "epochs": 10}
        for lr in [1e-3, 1e-4, 1e-5]
        for bs in [16, 32, 64]
    ]
    results = list(train_with_config.map(configs))
    best = max(results, key=lambda x: x["accuracy"])
    print(f"Best config: {best}")
```

## Debugging

### Interactive Shell

```bash
modal shell script.py  # Opens shell in container
```

### Logs

```bash
modal app logs my-app  # View logs
```

### Local Testing

```python
# Run function locally (no cloud)
if __name__ == "__main__":
    result = train_model.local(data)  # .local() runs on your machine
```

## Best Practices

1. **Pin package versions** for reproducibility
2. **Use volumes** for checkpoints and large files
3. **Set appropriate timeouts** (default is 5 min)
4. **Use GPU fallbacks** for availability: `gpu=["H100", "A100"]`
5. **Checkpoint frequently** for long jobs
6. **Use `.map()`** for parallel processing
7. **Start with smaller GPUs** and scale up as needed

## Pricing Notes

- Billed per second of GPU usage
- No charge when scaled to zero
- Volume storage: ~$0.20/GB/month
- Network egress: varies by region

## Links

- [Modal Docs](https://modal.com/docs)
- [Examples](https://modal.com/docs/examples)
- [GPU Guide](https://modal.com/docs/guide/gpu)
- [Pricing](https://modal.com/pricing)
