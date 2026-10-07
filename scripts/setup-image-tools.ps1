param([string]$Uv = '', [string]$RuntimeDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $RuntimeDirectory) { $RuntimeDirectory = Join-Path $projectRoot 'data/runtimes/image-tools' }
$RuntimeDirectory = [System.IO.Path]::GetFullPath($RuntimeDirectory)
if (-not $Uv) {
    $command = Get-Command uv.exe -ErrorAction SilentlyContinue
    $Uv = if ($command) { $command.Source } else { Join-Path $env:USERPROFILE '.local/bin/uv.exe' }
}
if (-not (Test-Path -LiteralPath $Uv)) { throw 'Install uv from https://docs.astral.sh/uv/getting-started/installation/ and rerun this script.' }
$python = Join-Path $RuntimeDirectory 'venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    & $Uv venv (Join-Path $RuntimeDirectory 'venv') --python 3.12
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
& $Uv pip install --python $python -r (Join-Path $PSScriptRoot 'image-tools-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Image tool dependency installation failed.' }
& $Uv pip install --python $python 'torch==2.7.1+cpu' 'torchvision==0.22.1+cpu' --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'CPU PyTorch installation failed.' }
$previousSamBuild = $env:SAM2_BUILD_CUDA
$env:SAM2_BUILD_CUDA = '0'
try {
    & $Uv pip install --python $python 'git+https://github.com/facebookresearch/sam2.git@2b90b9f5ceec907a1c18123530e92e794ad901a4' --no-build-isolation
    if ($LASTEXITCODE -ne 0) { throw 'SAM 2 installation failed.' }
} finally { $env:SAM2_BUILD_CUDA = $previousSamBuild }
$modelDirectory = Join-Path $RuntimeDirectory 'models'
New-Item -ItemType Directory -Path $modelDirectory -Force | Out-Null
$models = @(
    @{ name = 'ocr-det.onnx'; url = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx'; hash = '4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae' },
    @{ name = 'ocr-rec.onnx'; url = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx'; hash = '5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5' },
    @{ name = 'ocr-cls.onnx'; url = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx'; hash = 'e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c' },
    @{ name = 'birefnet.onnx'; url = 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx'; hash = '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333' },
    @{ name = 'lama.pt'; url = 'https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt'; hash = '344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9' },
    @{ name = 'sam2.pt'; url = 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt'; hash = '7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69' }
)
foreach ($model in $models) {
    $target = Join-Path $modelDirectory $model.name
    if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $model.hash) { continue }
    $partial = "$target.partial"
    Write-Host "Downloading $($model.name)"
    Invoke-WebRequest -Uri $model.url -OutFile $partial
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $model.hash) { throw "Model checksum mismatch: $($model.name)" }
    Move-Item -LiteralPath $partial -Destination $target -Force
}
& $python -c 'import torch, cv2, onnxruntime, sam2, rapidocr; print("Local image tools ready (CPU).")'
if ($LASTEXITCODE -ne 0) { throw 'Image tool runtime verification failed.' }
Write-Host "Runtime: $RuntimeDirectory"
