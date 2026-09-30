import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.deps import get_current_user, get_db
from app.core.rate_limit import limiter
from app.db_d1 import D1Client
from app.models.user import User
from app.schemas.payhero import (
    DepositInitiateOut,
    DepositInitiateRequest,
    DepositOut,
    PayHeroCallback,
)
from app.services.payhero_service import (
    PayHeroError,
    PayHeroNotConfigured,
    check_status,
    handle_callback,
    initiate_deposit,
    list_deposits,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payhero", tags=["payhero"])


@router.post("/deposit", response_model=DepositInitiateOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def create_deposit(
    request: Request,
    payload: DepositInitiateRequest,
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DepositInitiateOut:
    try:
        deposit = initiate_deposit(db, current_user, payload.amount, payload.phone_number)
    except PayHeroNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except PayHeroError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return DepositInitiateOut(
        external_reference=deposit.external_reference,
        checkout_request_id=deposit.checkout_request_id,
        status=deposit.status,
    )


@router.get("/deposit/{external_reference}", response_model=DepositOut)
def read_deposit_status(
    external_reference: str,
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DepositOut:
    try:
        deposit = check_status(db, current_user, external_reference)
    except PayHeroError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return DepositOut(**deposit.__dict__)


@router.get("/deposits", response_model=list[DepositOut])
def read_deposits(
    db: D1Client = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DepositOut]:
    return [DepositOut(**d.__dict__) for d in list_deposits(db, current_user)]


@router.post("/callback", include_in_schema=False)
def payhero_callback(payload: PayHeroCallback, db: D1Client = Depends(get_db)) -> dict:
    """PayHero calls this directly - no user JWT is available here, so the deposit
    is matched purely by the external_reference it echoes back. Never trust this
    endpoint to itself carry authorization for anything beyond marking that one
    specific, pre-created deposit row as settled."""
    try:
        deposit = handle_callback(db, payload)
    except PayHeroError as exc:
        logger.warning("PayHero callback could not be processed: %s", exc)
        # Still return 200 - PayHero retries on non-2xx, and retrying won't fix a
        # genuinely unmatched reference.
        return {"received": True, "matched": False}

    return {"received": True, "matched": True, "status": deposit.status}
