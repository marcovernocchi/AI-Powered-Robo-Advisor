"""FastAPI router for the backtesting endpoint."""

from fastapi import APIRouter, Depends, HTTPException

from backend.auth.router import get_current_user
from backend.backtesting import BacktestEngine, BacktestInput, BacktestResult
from backend.db.models import User

router = APIRouter(prefix="/backtest", tags=["backtesting"])


@router.post("", response_model=BacktestResult)
def run_backtest(
    params: BacktestInput,
    _: User = Depends(get_current_user),
) -> BacktestResult:
    """Run a portfolio backtest simulation.

    Requires authentication.  Accepts a BacktestInput payload and returns
    a BacktestResult with the full time series and performance metrics.
    """
    try:
        engine = BacktestEngine()
        return engine.run(params)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc}") from exc
