FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt ${LAMBDA_TASK_ROOT}

# Install build dependencies and poppler for PDF conversion
RUN dnf install -y gcc gcc-c++ python3-devel poppler-utils

RUN pip install -r requirements.txt

COPY handler.py ${LAMBDA_TASK_ROOT}

CMD [ "handler.handler" ]
