from fastapi import APIRouter, Depends

from backend.auth.router import get_current_user
from backend.db.models import User
from backend.monte_carlo import MonteCarloInput, MonteCarloResult, run_monte_carlo

router = APIRouter(prefix="/monte-carlo", tags=["monte-carlo"])


@router.post("", response_model=MonteCarloResult)
def run_simulation(
    params: MonteCarloInput,
    _: User = Depends(get_current_user),
) -> MonteCarloResult:
    return run_monte_carlo(params)
