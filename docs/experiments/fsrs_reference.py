# 공식 문서(awesome-fsrs 위키)와 공식 구현(py-fsrs scheduler.py)의 설명을 보고 독립적으로 다시 옮긴 참조 구현
import math, json, sys, random
P = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]
DEC = -P[20]; FAC = 0.9 ** (1 / DEC) - 1
def R(el, S): return (1 + FAC * el / S) ** DEC
def ivl(S, dr, mx=180): return min(max(round((S / FAC) * (dr ** (1 / DEC) - 1)), 1), mx)
def d0(g, lim=True):
    v = P[4] - math.e ** (P[5] * (g - 1)) + 1
    return min(max(v, 1), 10) if lim else v
def dnext(D, g):
    v = D + (10 - D) * (-(P[6] * (g - 3))) / 9
    v = P[7] * d0(4, False) + (1 - P[7]) * v
    return min(max(v, 1), 10)
def s_ok(D, S, r, g):
    hp = P[15] if g == 2 else 1; eb = P[16] if g == 4 else 1
    return S * (1 + math.e ** P[8] * (11 - D) * S ** (-P[9]) * (math.e ** ((1 - r) * P[10]) - 1) * hp * eb)
def s_fail(D, S, r):
    lt = P[11] * D ** (-P[12]) * ((S + 1) ** P[13] - 1) * math.e ** ((1 - r) * P[14])
    return min(lt, S / math.e ** (P[17] * P[18]))
def s_same(S, g):
    k = math.e ** (P[17] * (g - 3 + P[18])) * S ** (-P[19])
    if g >= 2: k = max(k, 1.0)
    return S * k
STEPS = [1, 10]
def review(st, g, now_min, dr=0.9, unknown=False):
    """st: dict(S,D,last(min),phase,step) 또는 None. now_min: 분 단위 시각."""
    st = dict(st) if st else dict(S=0, D=0, last=None, phase='new', step=0)
    el = 0 if st['last'] is None else max(0, (now_min - st['last']) / 1440)
    was_review = st['phase'] == 'review'
    if not st['S'] > 0:
        S = max(0.001, P[g - 1]); D = d0(g)
    elif el < 1:
        S = max(0.001, s_same(st['S'], g)); D = st['D'] if was_review else dnext(st['D'], g)
    else:
        r = R(el, st['S'])
        if g == 1:
            S = s_fail(st['D'], st['S'], r)
            if unknown: S *= 0.5
        else: S = s_ok(st['D'], st['S'], r, g)
        S = max(0.001, S); D = dnext(st['D'], g)
    out = dict(S=S, D=D, last=now_min, phase=st['phase'], step=st['step'], ivl=0, due_min=None)
    grad = False
    if was_review:
        if g == 1: out.update(phase='learn', step=0, due_min=STEPS[0])
        else: grad = True
    else:
        out['phase'] = 'learn'
        if g == 1: out.update(step=0, due_min=STEPS[0])
        elif g == 2: out['due_min'] = (STEPS[0] + STEPS[1]) / 2 if st['step'] == 0 else STEPS[min(st['step'], 1)]
        elif g == 3 and st['step'] + 1 < len(STEPS): out.update(step=st['step'] + 1, due_min=STEPS[st['step'] + 1])
        else: grad = True
    if grad: out.update(phase='review', step=0, ivl=ivl(S, dr))
    return out
if __name__ == '__main__':
    seqs = json.load(open(sys.argv[1])); res = []
    for sq in seqs:
        st = None; rows = []
        for (rating, now_min) in sq:
            g = {'unknown': 1, 'wrong': 1, 'close': 2, 'right': 3, 'known': 4}[rating]
            st = review(st, g, now_min, unknown=(rating == 'unknown'))
            rows.append([st['S'], st['D'], st['phase'], st['step'], st['ivl'], st['due_min']])
        res.append(rows)
    json.dump(res, open(sys.argv[2], 'w'))
