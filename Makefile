.PHONY: data install api web

install:
	npm run install:all

data:
	npm run data

api:
	npm run dev:api

web:
	npm run dev:web
