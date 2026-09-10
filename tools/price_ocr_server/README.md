# CardScope Local GPU Price OCR

This optional service runs on a local machine with a compatible PaddleOCR environment. The iPhone PWA uploads the scan photo to Next.js, and Next.js forwards the image to this local service at `http://127.0.0.1:8765/ocr-price`.

## Setup

Use Python 3.12, not the default Python 3.13.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Install the PaddlePaddle GPU wheel for Python 3.12 on NVIDIA 50-series Windows machines, then verify CUDA:

```powershell
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m pip install "https://paddle-qa.bj.bcebos.com/paddle-pipeline/Develop-TagBuild-Training-Windows-Gpu-Cuda12.9-Cudnn9.9-Trt10.5-Mkl-Avx-VS2019-SelfBuiltPypiUse/86d658f56ebf3a5a7b2b33ace48f22d10680d311/paddlepaddle_gpu-3.0.0.dev20250717-cp312-cp312-win_amd64.whl"
.\.venv\Scripts\python.exe -c "import paddle; print(paddle.__version__); print(paddle.is_compiled_with_cuda()); print(paddle.device.cuda.device_count()); paddle.utils.run_check()"
```

That wheel is the PaddleOCR-documented Windows package for Python 3.12 on NVIDIA 50-series GPUs.

## Run

```powershell
cd tools/price_ocr_server
.\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8765
```

The Next.js app defaults to this URL. Override it with:

```env
PRICE_OCR_URL=http://127.0.0.1:8765/ocr-price
```

## Notes

- GiblTCG still does card identity only.
- This service does price OCR only.
- If this service is not running, the app falls back to browser Tesseract and shows a warning.
