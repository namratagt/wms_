import sys

N = 15
# border and centre row/col walkable
grid = [[False]*N for _ in range(N)]
for i in range(N):
    grid[0][i] = True
    grid[N-1][i] = True
    grid[i][0] = True
    grid[i][N-1] = True
for i in range(N):
    grid[N//2][i] = True
    grid[i][N//2] = True

visited = [[False]*N for _ in range(N)]

class Robot:
    def __init__(self, r, c):
        self.r = r
        self.c = c

class Pickup:
    def __init__(self, r, c):
        self.r = r
        self.c = c

def find_path(robot, pickup):
    if robot.r == pickup.r and robot.c == pickup.c:
        return [(robot.r, robot.c)]
    visited[robot.r][robot.c] = True
    # prefer down, right, up, left
    moves = [(1,0),(0,1),(-1,0),(0,-1)]
    for dr,dc in moves:
        nr, nc = robot.r+dr, robot.c+dc
        if 0 <= nr < N and 0 <= nc < N and grid[nr][nc] and not visited[nr][nc]:
            sub = find_path(Robot(nr,nc), pickup)
            if sub is not None:
                return [(robot.r, robot.c)] + sub
    visited[robot.r][robot.c] = False
    return None

if __name__ == "__main__":
    bot = Robot(1,1)
    pt = Pickup(7,7)
    p = find_path(bot, pt)
    print(p if p else "no path")