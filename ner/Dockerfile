# The tagger of NewsGenerator (named entities, GLiNER) on a machine without an NVIDIA card: PyTorch for
# the processor. Built and started apart, as the embedder (see ner/server.py):
#   docker build -t newsgenerator-ner:cpu .
#   docker run -d --name newsgenerator-ner --restart unless-stopped --cpus 3 --memory 3g \
#     -p <address>:8021:8021 --env-file token.env -e NER_THREADS=3 -v "$PWD/cache:/cache" newsgenerator-ner:cpu
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt
COPY server.py .
ENV NER_HOST=0.0.0.0 HF_HOME=/cache
EXPOSE 8021
CMD ["python", "-u", "server.py"]
