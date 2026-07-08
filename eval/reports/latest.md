# Evaluation report (full)

Run: 2026-07-08T11:13:34.558Z · chat model `gemini-3.5-flash-lite` · embeddings `gemini-embedding-001` (768d) · top-k 8 · 368 s

| metric | value | threshold |
|---|---|---|
| Retrieval recall@8 (hybrid) | 100.0% | 90.0% |
| Retrieval recall@1 (hybrid) | 86.8% | – |
| Retrieval MRR (hybrid) | 93.4% | – |
| Answer accuracy (all) | 100.0% | – |
| Numeric answer accuracy | 100.0% | 80.0% |
| Citation accuracy | 100.0% | 80.0% |
| Not-in-document accuracy | 100.0% | 75.0% |
| Tool used when arithmetic needed | 100.0% | – |
| Extraction field accuracy (5 loan docs) | 100.0% | 85.0% |
| Contract facts accuracy (lease) | 100.0% | – |
| Risk flag precision | 93.3% | – |
| Risk flag recall | 100.0% | – |

## Retrieval

53 questions with expected pages. A hit means a retrieved chunk overlaps an expected page; MRR uses the rank of the first hit.

| Retriever | recall@1 | recall@4 | recall@8 | MRR |
|---|---|---|---|---|
| hybrid (RRF) | 86.8% | 100.0% | 100.0% | 0.934 |
| vector only | 96.2% | 98.1% | 98.1% | 0.972 |
| full-text only | 73.6% | 90.6% | 96.2% | 0.824 |

## Chunk size ablation (hybrid)

| max tokens | recall@1 | recall@8 | MRR | avg chunks/doc |
|---|---|---|---|---|
| 200 | 90.6% | 100.0% | 0.947 | 21.7 |
| 400 | 86.8% | 100.0% | 0.934 | 17.6 |
| 800 | 86.8% | 100.0% | 0.934 | 17.3 |

## Question answering

59 questions.

| id | type | correct | cited page | tools | answer |
|---|---|---|---|---|---|
| personal-loan-fixed/rate | numeric | yes | yes | 0 | The rate of interest on this loan is 14% per annum, and it is fixed [1, 3]. |
| personal-loan-fixed/tenure | numeric | yes | yes | 0 | The loan has 36 equated monthly instalments [1, 5]. |
| personal-loan-fixed/emi | numeric | yes | yes | 0 | The EMI amount stated in the agreement is Rs. 17,088.81 [2, 3]. |
| personal-loan-fixed/principal | numeric | yes | yes | 0 | Under this agreement, a loan amount of Rs. 5,00,000 (Rupees Five Lakh only) is being lent [1, 6]. |
| personal-loan-fixed/prepay | numeric | yes | yes | 0 | Yes, you may prepay or foreclose the loan [2]. However, no prepayment is permitted during the first 12 EMIs [2 |
| personal-loan-fixed/bounce | numeric | yes | yes | 0 | If an EMI payment bounces due to a dishonoured cheque, NACH mandate, or standing instruction, you must pay Rs. |
| personal-loan-fixed/ear | numeric | yes | yes | 2 | Including all upfront charges (processing fee of Rs. 10,000, insurance premium of Rs. 6,500, and GST on proces |
| personal-loan-fixed/interest-total | numeric | yes | yes | 2 | Over the full tenure of 36 months, if you pay every EMI on time, the total interest you will pay is Rs. 1,15,1 |
| home-loan-floating/rate | numeric | yes | yes | 0 | The interest rate on the loan is a floating rate of 8.75% per annum, calculated as the Sunrise Prime Lending R |
| home-loan-floating/tenure | numeric | yes | yes | 0 | The loan has 240 equated monthly instalments [1, 6]. |
| home-loan-floating/emi | numeric | yes | yes | 0 | The EMI amount stated in the agreement is Rs. 35,348.43 [2, 3]. |
| home-loan-floating/principal | numeric | yes | yes | 0 | The loan amount under this agreement is Rs. 40,00,000 (Rupees Forty Lakh only) [1, 4]. |
| home-loan-floating/prepay | numeric | yes | yes | 0 | You may prepay or foreclose the loan in full or in part at any time [1]. For floating rate loans to individual |
| home-loan-floating/bounce | numeric | yes | yes | 0 | If an EMI payment bounces due to a dishonoured cheque, NACH mandate, or standing instruction, you are charged  |
| home-loan-floating/ear | numeric | yes | yes | 2 | The effective annual interest rate (IRR) on your loan is 9.34% (with an APR of 8.96%) [1, 3]. This calculation |
| home-loan-floating/interest-total | numeric | yes | yes | 2 | Over the full tenure of 240 months, the total interest you will pay is Rs. 44,83,623.20 [1, 3]. |
| vehicle-loan-flat/rate | numeric | yes | yes | 0 | The interest rate on the loan is 9.5% per annum, and it is a fixed rate calculated on a flat rate basis on the |
| vehicle-loan-flat/tenure | numeric | yes | yes | 0 | The loan has 60 equated monthly instalments [1, 4]. |
| vehicle-loan-flat/emi | numeric | yes | yes | 0 | The EMI amount stated in the agreement is Rs. 19,666.67 [2, 6]. |
| vehicle-loan-flat/principal | numeric | yes | yes | 0 | The loan amount being lent under this agreement is Rs. 8,00,000 [2, 5]. |
| vehicle-loan-flat/prepay | numeric | yes | yes | 1 | Yes, you may prepay or foreclose the loan subject to a prepayment charge of 5% of the principal outstanding pl |
| vehicle-loan-flat/bounce | numeric | yes | yes | 0 | If an EMI payment bounces due to the dishonour of a cheque, NACH mandate, or standing instruction, you are cha |
| vehicle-loan-flat/ear | numeric | yes | yes | 2 | Based on the loan details, the upfront charges total Rs. 10,500.00 (comprising a processing fee of Rs. 8,000,  |
| vehicle-loan-flat/interest-total | numeric | yes | yes | 2 | You will pay a total interest of Rs. 3,80,000.20 over the 60-month tenure [1, 3]. |
| business-loan-kfs/rate | numeric | yes | yes | 0 | The rate of interest on this loan is 16% per annum, and it is fixed on a reducing balance basis [1, 2, 4]. |
| business-loan-kfs/tenure | numeric | yes | yes | 0 | The loan has 48 equated monthly instalments [1, 3, 6]. |
| business-loan-kfs/emi | numeric | yes | yes | 0 | The EMI (Equated Monthly Instalment) amount stated in the agreement is Rs. 70,850.70 [2, 3, 5]. |
| business-loan-kfs/principal | numeric | yes | yes | 0 | The loan amount being lent under this agreement is Rs. 25,00,000 (Rupees Twenty-Five Lakh only) [2, 5]. |
| business-loan-kfs/prepay | numeric | yes | yes | 1 | Yes, you can foreclose the loan, but it is permitted only after 6 months [1, 2]. The foreclosure will cost you |
| business-loan-kfs/bounce | numeric | yes | yes | 0 | If an EMI payment bounces, a charge of Rs. 1,000 per bounced EMI is payable [1, 3, 4]. This is in addition to  |
| business-loan-kfs/ear | numeric | yes | yes | 2 | The true effective annual rate (EAR) on this loan, including all upfront charges (processing fee of Rs. 62,500 |
| business-loan-kfs/interest-total | numeric | yes | yes | 2 | Over the full 48-month tenure, the total interest you will pay is **Rs. 9,00,833.60** [1, 3]. |
| education-loan-floating/rate | numeric | yes | yes | 0 | The loan has a floating interest rate, which is presently 11.25% per annum [1, 2]. This rate is calculated on  |
| education-loan-floating/tenure | numeric | yes | yes | 0 | The loan has 84 equated monthly instalments [1, 4]. |
| education-loan-floating/emi | numeric | yes | yes | 0 | The EMI amount stated in the agreement is Rs. 20,705 [2, 4]. |
| education-loan-floating/principal | numeric | yes | yes | 0 | The loan amount being lent under this agreement is Rs. 12,00,000 (Rupees Twelve Lakh only) [1, 5]. |
| education-loan-floating/prepay | numeric | yes | yes | 0 | You can prepay or foreclose the loan in full or in part at any time without charge (nil cost) [1]. |
| education-loan-floating/bounce | numeric | yes | yes | 0 | If an EMI payment bounces, you must pay Rs. 250 per dishonoured instruction, in addition to any charges levied |
| education-loan-floating/ear | numeric | yes | yes | 2 | Taking into account the loan amount of Rs. 12,00,000 [2], an interest rate of 11.25% per annum [2], an 84-mont |
| education-loan-floating/interest-total | numeric | yes | yes | 2 | Over the full tenure of 84 months, if you pay every EMI on time, you will pay a total interest of Rs. 5,39,220 |
| personal-loan-fixed/nid-guarantor | not_in_document | yes | – | 0 | The document does not state whether there is a guarantor for this loan. |
| home-loan-floating/nid-moratorium | not_in_document | yes | – | 0 | The document does not state the length of a moratorium period before EMIs start. |
| vehicle-loan-flat/nid-cooling | not_in_document | yes | – | 0 | The document does not state whether there is a cooling-off period to return the loan without penalty. |
| education-loan-floating/nid-collateral | not_in_document | yes | – | 0 | The document does not state what collateral or property is mortgaged for this loan. |
| business-loan-kfs/cooling | text | yes | yes | 0 | Yes, there is a cooling-off period of 3 working days from disbursement, during which the loan may be returned  |
| home-loan-floating/benchmark | text | yes | yes | 0 | The floating rate is linked to the Sunrise Prime Lending Rate (SPLR) minus 2.25% [1, 3]. |
| personal-loan-fixed/arbitration | text | yes | yes | 0 | Disputes are referred to the sole arbitration of an arbitrator appointed by the Lender under the Arbitration a |
| vehicle-loan-flat/flat | text | yes | yes | 0 | Interest is calculated on a flat rate basis on the original loan amount for the entire tenure, rather than on  |
| residential-lease/rent | numeric | yes | yes | 0 | The monthly licence fee is Rs. 38,000, and it is payable in advance on or before the 5th day of each month [1, |
| residential-lease/deposit | numeric | yes | yes | 0 | The security deposit is Rs. 2,28,000 [1, 2]. |
| residential-lease/lockin | text | yes | yes | 0 | The lock-in period is the first 12 months of the term [1, 2]. If you terminate the agreement or abandon the pr |
| residential-lease/notice | numeric | yes | yes | 0 | After the lock-in period, either party may terminate the agreement by giving at least 60 days' written notice  |
| residential-lease/renewal | text | yes | yes | 0 | Yes, the agreement renews automatically for a further period of 12 months on the same terms, unless either par |
| residential-lease/nid-parking | not_in_document | yes | – | 0 | The document does not state which parking slot is allotted to the tenant. |
| lecture-notes-tvm/pv | numeric | yes | yes | 0 | The present value of the scholarship in the worked example is Rs. 39,927 [1]. |
| lecture-notes-tvm/emi-example | numeric | yes | yes | 0 | Based on the worked example provided in the document, the monthly instalment (EMI) is Rs. 21,247 [1]. |
| lecture-notes-tvm/ear | numeric | yes | yes | 0 | A nominal annual rate of 12% compounded monthly works out to an effective annual rate (EAR) of 12.68% per year |
| lecture-notes-tvm/flat-error | text | yes | yes | 0 | The notes warn against computing interest on the original principal every month, which is the flat-rate method |
| lecture-notes-tvm/nid-lecturer | not_in_document | yes | – | 0 | NOT_IN_DIRECTORY NOT_IN_DOCUMENT The document does not state the name of the lecturer teaching the course. |

## Extraction

| field | accuracy |
|---|---|
| lenderName | 100.0% |
| principal | 100.0% |
| interestRate.annualPercent | 100.0% |
| interestRate.rateType | 100.0% |
| interestRate.method | 100.0% |
| tenureMonths | 100.0% |
| statedEmi | 100.0% |
| processingFee | 100.0% |
| insurancePremium | 100.0% |
| otherUpfrontCharges.total | 100.0% |
| prepaymentCharges | 100.0% |
| latePaymentCharges | 100.0% |
| bounceCharges | 100.0% |

## Contract facts (residential lease)

| fact | contains | got |
|---|---|---|
| term | 24 | yes: 24 months, ending on 31 July 2028 |
| paymentObligations | 38,000 | yes: Rs. 38,000 per month in advance on or before the 5th day of each month by electr |
| securityDeposit | 2,28,000 | yes: Rs. 2,28,000, refundable within 60 days of the Licensee vacating the Premises af |
| noticePeriod | 60 | yes: 60 days' written notice after the Lock-in Period |
| renewal | 10% | yes: Automatically renews for a further period of 12 months on the same terms with th |
| governingLaw | arbitrat | yes: Governed by the laws of India; disputes referred to sole arbitration of an arbit |
| effectiveDate | August 2026 | yes: 1 August 2026 |
| parties | Deshpande | yes: Mrs. Sunita Deshpande (Licensor) Kabir Malhotra (Licensee) |

## Risk flags

| document | expected | found | missed | extra |
|---|---|---|---|---|
| personal-loan-fixed | 4 | 4 | – | – |
| home-loan-floating | 4 | 5 | – | penal_interest |
| vehicle-loan-flat | 4 | 5 | – | auto_debit_mandate |
| business-loan-kfs | 4 | 4 | – | – |
| education-loan-floating | 4 | 4 | – | – |
| residential-lease | 8 | 8 | – | – |

