.PHONY: up down api-dev

up:
	docker compose up -d --build

down:
	docker compose down

api-dev:
	cd backend && python main.py
