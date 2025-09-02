# Loto Microservices Project

A microservices-based lottery application built with Node.js, Docker, PostgreSQL, and RabbitMQ.

## Architecture

- **Gateway Service** (Port 3000): API Gateway handling external requests
- **Auth Service** (Port 3001): Authentication and user management
- **Lottery Service** (Port 3002): Lottery draw and bet management
- **RabbitMQ**: Message broker for inter-service communication
- **PostgreSQL**: Separate databases for each service

## Prerequisites

- Docker Desktop
- Docker Compose
- Node.js 18+ (for local development)

## Installation

1. Clone the repository:
```bash
git clone [your-repo-url]
cd loto-project