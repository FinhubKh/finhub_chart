.PHONY: data install api web upload-r2

install:
	npm run install:all

data:
	npm run data

upload-r2:
	python3 scripts/upload_r2.py

api:
	npm run dev:api

web:
	npm run dev:web
