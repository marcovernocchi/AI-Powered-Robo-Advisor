import io
import json
import pandas as pd
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from backend.database import get_db
from backend.db.models import User, Portfolio, Holding
from backend.auth.router import get_current_user
from backend.config import settings

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

COLUMN_ALIASES = {
    'ticker':        ['ticker', 'symbol', 'strumento', 'titolo', 'codice_titolo', 'simbolo'],
    'isin':          ['isin', 'codice_isin'],
    'asset_name':    ['name', 'nome', 'nome_etf', 'descrizione', 'description', 'denominazione'],
    'asset_type':    ['tipo', 'type', 'asset_type', 'categoria', 'category'],
    'shares':        ['shares', 'quantity', 'quantita', 'quantità', 'qty', 'qtà', 'qta',
                      'numero_titoli', 'pezzi', 'num', 'numero'],
    'avg_buy_price': ['price', 'prezzo', 'costo', 'avg_price', 'avg_buy_price', 'prezzo_medio',
                      'prezzo_medio_(€)', 'prezzo_medio_(eur)', 'prezzo_medio_eur',
                      'prezzo_carico', 'prezzo_di_carico', 'prezzo_acquisto', 'purchase_price',
                      'corso_acquisto'],
    'purchase_date': ['date', 'data', 'purchase_date', 'data_acquisto', 'transaction_date',
                      'data_transazione', 'data_operazione'],
    'fees':          ['fees', 'commissioni', 'fee', 'commissione', 'costi'],
}

ASSET_TYPE_MAP = {
    # Equity (azioni singole)
    'equity':          'equity',
    'azionario':       'equity',
    'azione':          'equity',
    'azioni':          'equity',
    'stock':           'equity',
    'security':        'equity',
    # ETF azionario
    'etf_azionario':   'etf_equity',
    'etf_equity':      'etf_equity',
    'etf_azionari':    'etf_equity',
    # ETF obbligazionario
    'etf_obbligazionario': 'etf_bond',
    'etf_bond':        'etf_bond',
    'etf_obblig':      'etf_bond',
    # Bond singoli
    'obbligazionario': 'bond',
    'obbligazione':    'bond',
    'obbligazioni':    'bond',
    'bond':            'bond',
    # Crypto
    'crypto':          'crypto',
    'criptovaluta':    'crypto',
    'cryptocurrency':  'crypto',
    # Commodity
    'materia_prima':   'commodity',
    'materie_prime':   'commodity',
    'commodity':       'commodity',
    # Cash
    'cash':            'cash',
    'liquidita':       'cash',
    'liquidità':       'cash',
    'contante':        'cash',
}


def clean_number(val) -> Optional[float]:
    """Convert values like '1,800' (US thousands) or '1.800,50' (EU) to float."""
    s = str(val).strip().replace('€', '').replace('$', '').strip()
    if s.lower() in ('nan', '', '-', 'n/a', 'totale'):
        return None
    # European format: 1.800,50 → has both dot and comma, comma last
    if ',' in s and '.' in s and s.index('.') < s.index(','):
        s = s.replace('.', '').replace(',', '.')
    # US format: 1,800.50 → strip commas
    elif ',' in s and '.' in s:
        s = s.replace(',', '')
    # Only comma: could be decimal (1,5) or thousands (1,800)
    elif ',' in s and '.' not in s:
        parts = s.split(',')
        if len(parts) == 2 and len(parts[1]) == 3:
            s = s.replace(',', '')   # thousands separator
        else:
            s = s.replace(',', '.')  # decimal separator
    try:
        return float(s)
    except ValueError:
        return None


def detect_columns(df_cols):
    """Match DataFrame column names to our field names."""
    normalized = {}
    for col in df_cols:
        norm = str(col).lower().strip()
        norm = norm.replace(' ', '_').replace('(', '').replace(')', '')
        normalized[col] = norm
    mapping = {}
    for field, aliases in COLUMN_ALIASES.items():
        for orig, norm in normalized.items():
            if norm in aliases:
                mapping[field] = orig
                break
    return mapping


def try_parse_excel(content: bytes) -> pd.DataFrame:
    """Try reading Excel with header on row 0, then row 1 (for files with a title row)."""
    for header_row in (0, 1):
        try:
            df = pd.read_excel(io.BytesIO(content), header=header_row)
            mapping = detect_columns(df.columns)
            # Accept if we can at least find ticker/isin AND shares
            if ('ticker' in mapping or 'isin' in mapping) and 'shares' in mapping:
                return df
        except Exception:
            continue
    # Fall back to header=1 (title row is very common in Italian broker exports)
    return pd.read_excel(io.BytesIO(content), header=1)


def ai_detect_columns(df: pd.DataFrame) -> dict:
    """Ask Groq to map DataFrame columns to our field names."""
    from groq import Groq

    columns = list(df.columns)
    sample = df.dropna(how='all').head(3).astype(str).to_dict(orient='records')

    prompt = f"""You are analyzing a financial portfolio spreadsheet exported from a broker.
Columns: {columns}
Sample rows (first 3): {json.dumps(sample, ensure_ascii=False)}

Map each column to one of these field names (or null if no match):
- ticker: stock/ETF symbol (e.g. AAPL, IWDA.AS, VWCE.DE)
- isin: ISIN code (e.g. IE00B4L5Y983)
- asset_name: full name/description of the asset
- asset_type: category (e.g. Azionario, Obbligazionario, stock, bond, crypto)
- shares: quantity / number of units held
- avg_buy_price: average purchase price per unit
- purchase_date: date of purchase
- fees: transaction fees or commissions

Return ONLY a valid JSON object using the exact column names from the list above.
Example: {{"ticker": "Ticker", "isin": "ISIN", "shares": "Quantità", "avg_buy_price": "Prezzo Medio (€)", "asset_name": "Nome ETF", "asset_type": "Tipo", "purchase_date": null, "fees": null}}"""

    client = Groq(api_key=settings.groq_api_key)
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=300,
        temperature=0.0,
    )

    content = response.choices[0].message.content
    start, end = content.find('{'), content.rfind('}') + 1
    mapping_raw = json.loads(content[start:end])

    return {
        field: col
        for field, col in mapping_raw.items()
        if col and col != 'null' and col in df.columns
    }


def ai_classify_asset_types(tickers: list[str]) -> dict[str, str]:
    """Ask Groq to classify tickers/ISINs into asset types."""
    from groq import Groq

    valid_types = {'equity', 'etf_equity', 'etf_bond', 'bond', 'crypto', 'commodity', 'cash'}

    prompt = f"""You are a financial data classifier. Classify each ticker or ISIN into one of these asset types:
- equity: single stocks (e.g. AAPL, ENI.MI, MSFT, ENEL.MI)
- etf_equity: equity/stock ETFs (e.g. VWCE.DE, SPY, IWDA.AS, SWDA.MI)
- etf_bond: bond/fixed income ETFs (e.g. AGGH, BND, TLT, VAGF.MI, XGLE.MI)
- bond: individual bonds or BTPs (e.g. IT0001278511, BTP2030)
- crypto: cryptocurrencies (e.g. BTC-USD, ETH-USD)
- commodity: commodity ETFs or futures (e.g. GLD, USO)
- cash: cash or money market funds

Tickers to classify: {tickers}

Return ONLY a valid JSON object mapping each ticker to its type.
Example: {{"AAPL": "equity", "VWCE.DE": "etf_equity", "TLT": "etf_bond"}}"""

    client = Groq(api_key=settings.groq_api_key)
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
        temperature=0.0,
    )

    content = response.choices[0].message.content
    start, end = content.find('{'), content.rfind('}') + 1
    result = json.loads(content[start:end])
    return {ticker: atype if atype in valid_types else 'equity' for ticker, atype in result.items()}


def smart_detect_columns(df: pd.DataFrame) -> dict:
    """Try AI detection first, fall back to alias matching."""
    try:
        mapping = ai_detect_columns(df)
        if ('ticker' in mapping or 'isin' in mapping) and 'shares' in mapping and 'avg_buy_price' in mapping:
            return mapping
    except Exception:
        pass
    return detect_columns(df.columns)


def resolve_ticker(row, mapping):
    """Resolves a ticker symbol from a given row and mapping, prioritizing the 'ticker' field and falling back to 'isin' with yfinance lookup."""
    if 'ticker' in mapping:
        val = str(row[mapping['ticker']]).strip()
        if val and val.lower() not in ('nan', ''):
            return val.upper()
    if 'isin' in mapping:
        isin = str(row[mapping['isin']]).strip()
        if isin and isin.lower() not in ('nan', ''):
            try:
                import yfinance as yf
                sym = yf.Ticker(isin).fast_info.symbol
                return sym.upper() if sym else isin.upper()
            except Exception:
                return isin.upper()
    return None


class BulkHolding(BaseModel):
    ticker: str
    asset_name: Optional[str] = None
    asset_type: str = 'equity'
    shares: float
    avg_buy_price: float
    purchase_date: Optional[str] = None
    fees: Optional[float] = 0.0


class BulkImportRequest(BaseModel):
    holdings: list[BulkHolding]
    portfolio_id: int


@router.post("/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Imports a file preview, parsing CSV or Excel files and validating their contents to extract asset information."""
    ext = file.filename.lower().rsplit('.', 1)[-1] if '.' in file.filename else ''
    content = await file.read()

    try:
        if ext == 'csv':
            df = None
            for sep in [',', ';', '\t']:
                try:
                    candidate = pd.read_csv(io.BytesIO(content), sep=sep)
                    if len(candidate.columns) > 1:
                        mapping = detect_columns(candidate.columns)
                        if ('ticker' in mapping or 'isin' in mapping) and 'shares' in mapping:
                            df = candidate
                            break
                        if df is None:
                            df = candidate
                except Exception:
                    continue
            if df is None:
                raise HTTPException(status_code=400, detail="Could not parse CSV file.")
        elif ext in ('xlsx', 'xls'):
            df = try_parse_excel(content)
        else:
            raise HTTPException(status_code=400, detail="Unsupported format. Use CSV or Excel (.xlsx, .xls).")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=400, detail="File is empty.")

    mapping = smart_detect_columns(df)

    if 'ticker' not in mapping and 'isin' not in mapping:
        raise HTTPException(
            status_code=422,
            detail=f"Could not find a ticker or ISIN column. Found columns: {list(df.columns)}",
        )
    missing = [f for f in ('shares', 'avg_buy_price') if f not in mapping]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Could not find required columns: {', '.join(missing)}. Found columns: {list(df.columns)}",
        )

    rows = []
    for _, row in df.iterrows():
        shares_val = clean_number(row[mapping['shares']])
        price_val  = clean_number(row[mapping['avg_buy_price']])
        if shares_val is None or price_val is None or shares_val <= 0 or price_val <= 0:
            continue

        ticker = resolve_ticker(row, mapping)
        if not ticker:
            continue

        name = None
        if 'asset_name' in mapping:
            raw = row[mapping['asset_name']]
            if not pd.isna(raw):
                name = str(raw).strip()

        asset_type = 'equity'
        if 'asset_type' in mapping:
            raw = str(row[mapping['asset_type']]).lower().strip().replace(' ', '_')
            asset_type = ASSET_TYPE_MAP.get(raw, 'equity')

        date_str = None
        if 'purchase_date' in mapping:
            raw = row[mapping['purchase_date']]
            if not pd.isna(raw):
                try:
                    date_str = pd.to_datetime(raw, dayfirst=True).strftime('%Y-%m-%d')
                except Exception:
                    pass

        fees_val = 0.0
        if 'fees' in mapping:
            raw = row[mapping['fees']]
            v = clean_number(raw)
            if v is not None:
                fees_val = v

        rows.append({
            'ticker': ticker,
            'asset_name': name,
            'asset_type': asset_type,
            'shares': shares_val,
            'avg_buy_price': price_val,
            'purchase_date': date_str,
            'fees': fees_val,
        })

    if not rows:
        raise HTTPException(status_code=422, detail="No valid rows found in the file.")

    if 'asset_type' not in mapping:
        try:
            tickers = [r['ticker'] for r in rows]
            classifications = ai_classify_asset_types(tickers)
            for r in rows:
                r['asset_type'] = classifications.get(r['ticker'], 'equity')
        except Exception:
            pass

    return {'rows': rows, 'total': len(rows)}


@router.post("/import/confirm", status_code=201)
def import_confirm(
    data: BulkImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Imports holdings into a user's portfolio based on the provided bulk import request."""
    portfolio = db.query(Portfolio).filter(
        Portfolio.id == data.portfolio_id,
        Portfolio.user_id == current_user.id,
    ).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    from datetime import date as date_type
    for h in data.holdings:
        purchase_date = None
        if h.purchase_date:
            try:
                purchase_date = date_type.fromisoformat(h.purchase_date)
            except ValueError:
                pass
        db.add(Holding(
            portfolio_id=portfolio.id,
            ticker=h.ticker.upper(),
            asset_name=h.asset_name,
            asset_type=h.asset_type,
            shares=h.shares,
            avg_buy_price=h.avg_buy_price,
            purchase_date=purchase_date,
            fees=h.fees or 0.0,
        ))
    db.commit()
    return {'message': f'{len(data.holdings)} holdings imported', 'created': len(data.holdings)}
