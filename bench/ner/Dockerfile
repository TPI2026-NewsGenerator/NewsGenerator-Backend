FROM python:3.12-slim
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "gliner>=0.2.16" "onnxruntime>=1.20"
WORKDIR /app
ENV HF_HOME=/cache
