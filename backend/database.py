from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import URL
import os
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Build URL programmatically to handle special characters in password
DATABASE_URL = os.environ.get('DATABASE_URL', '')

if DATABASE_URL:
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        pool_size=20,       # Increased for better concurrency
        max_overflow=30,    # Allow more burst connections
        pool_timeout=30,
        pool_recycle=300,
        pool_pre_ping=True,
    )
else:
    # Fallback: construct from individual parts
    DB_HOST = os.environ.get('DB_HOST', 'aws-1-ap-south-1.pooler.supabase.com')
    DB_PORT = int(os.environ.get('DB_PORT', '5432'))
    DB_USER = os.environ.get('DB_USER', 'postgres')
    DB_PASS = os.environ.get('DB_PASS', '')
    DB_NAME = os.environ.get('DB_DATABASE', 'postgres')
    url = URL.create("postgresql+asyncpg", username=DB_USER, password=DB_PASS, host=DB_HOST, port=DB_PORT, database=DB_NAME)
    engine = create_async_engine(url, echo=False, pool_size=20, max_overflow=30, pool_timeout=30, pool_recycle=300, pool_pre_ping=True)

async_session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
