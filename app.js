const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const format = require("date-fns/format");
const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

//API-1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user where username = '${username}';`;
  const user = await db.get(getUserQuery);

  if (user === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `INSERT INTO user 
        (username, password, name, gender) VALUES 
        (
            '${username}',
            '${hashedPassword}',
            '${name}',
            '${gender}'
        );`;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API - 2;
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await db.get(getUserQuery);
  if (user === undefined) {
    response.status(400);
    response.send("Invalid User");
  } else {
    const isPasswordMatching = await bcrypt.compare(password, user.password);
    if (isPasswordMatching) {
      const payload = { user_id: user.user_id, username: username };
      const jwtToken = jwt.sign(payload, "SECRET_TWITTER");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid Password");
    }
  }
});

const authenticateJwtToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_TWITTER", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.user_id = payload.user_id;
        next();
      }
    });
  }
};

//API-3
app.get(
  "/user/tweets/feed/",
  authenticateJwtToken,
  async (request, response) => {
    const user_id = request.user_id;
    const getTweetQuery = `
    SELECT 
    user.name as username, 
    tweet.tweet as tweet, 
    tweet.date_time as date_time
    FROM user
    JOIN follower ON user.user_id = follower.following_user_id
    JOIN tweet ON follower.following_user_id = tweet.user_id
    WHERE follower.follower_user_id = ${user_id}
    ORDER BY tweet.date_time DESC LIMIT 4;
    `;
    const tweet = await db.all(getTweetQuery);
    response.send(
      tweet.map((eachTweet) => {
        return {
          username: eachTweet.username,
          tweet: eachTweet.tweet,
          dateTime: eachTweet.date_time,
        };
      })
    );
  }
);

//API-4
app.get("/user/following/", authenticateJwtToken, async (request, response) => {
  const user_id = request.user_id;
  const getUserFollowingQuery = `SELECT username FROM user JOIN follower ON user.user_id = following_user_id where follower_user_id = ${user_id};`;
  const userFollowing = await db.all(getUserFollowingQuery);
  response.send(
    userFollowing.map((eachFollowing) => {
      return {
        name: eachFollowing.username,
      };
    })
  );
});

//API-5
app.get("/user/followers/", authenticateJwtToken, async (request, response) => {
  const user_id = request.user_id;
  const getUserFollowerQuery = `select username from user join follower on user.user_id = follower.follower_user_id  where following_user_id = ${user_id};`;
  const userFollower = await db.all(getUserFollowerQuery);
  response.send(
    userFollower.map((eachFollower) => {
      return {
        name: eachFollower.username,
      };
    })
  );
});

//middleware-validateTweetId
const validateTweetId = async (request, response, next) => {
  const userId = request.user_id;
  const tweetId = parseInt(request.params.tweetId);
  const getFollowingUserTweetIdQuery = `SELECT tweet_id from tweet join follower on tweet.user_id = following_user_id where follower_user_id = ${userId};`;
  const tweets = await db.all(getFollowingUserTweetIdQuery);
  const tweetIdArray = tweets.map((eachTweet) => eachTweet.tweet_id);
  if (tweetIdArray.includes(tweetId)) {
    next();
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
};

//API-6
app.get(
  "/tweets/:tweetId/",
  authenticateJwtToken,
  validateTweetId,
  async (request, response) => {
    const tweetId = parseInt(request.params.tweetId);
    const getTweetQuery = `SELECT
        tweet.tweet,
        COUNT(DISTINCT like.like_id) as likes,
        COUNT(DISTINCT reply.reply_id) as replies,
        tweet.date_time as dateTime
        FROM
        tweet
        LEFT JOIN
        like ON tweet.tweet_id = like.tweet_id
        LEFT JOIN
        reply ON tweet.tweet_id = reply.tweet_id
        WHERE
        tweet.tweet_id = ${tweetId}
        GROUP BY
        tweet.tweet_id;`;
    const tweetInfo = await db.get(getTweetQuery);
    response.send({
      tweet: tweetInfo.tweet,
      likes: tweetInfo.likes,
      replies: tweetInfo.replies,
      dateTime: tweetInfo.dateTime,
    });
  }
);

//API-7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateJwtToken,
  validateTweetId,
  async (request, response) => {
    const tweetId = parseInt(request.params.tweetId);
    const getLikedUserQuery = `
    SELECT name FROM user JOIN like ON user.user_id = like.user_id where tweet_id = ${tweetId};`;
    const likedUser = await db.all(getLikedUserQuery);
    response.send(
      likedUser.map((eachUser) => {
        return {
          name: eachUser.name,
        };
      })
    );
  }
);

//API-8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateJwtToken,
  validateTweetId,
  async (request, response) => {
    const tweetId = parseInt(request.params.tweetId);
    const getLikedUserQuery = `
    SELECT name, reply FROM user JOIN reply ON user.user_id = reply.user_id where tweet_id = ${tweetId};`;
    const likedUser = await db.all(getLikedUserQuery);
    response.send(
      likedUser.map((eachUser) => {
        return {
          name: eachUser.name,
          reply: eachUser.reply,
        };
      })
    );
  }
);

//API-9
app.get("/user/tweets/", authenticateJwtToken, async (request, response) => {
  const userId = request.user_id;
  const getUserTweetsQuery = `SELECT 
    tweet, 
    count(DISTINCT like_id) as likes,
    count(DISTINCT reply_id) as replies,
    date_time as dateTime
    FROM tweet 
    JOIN like on tweet.tweet_id = like.tweet_id
    JOIN reply on tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${userId}
    group by tweet.tweet_id;
    `;
  const UserTweets = await db.all(getUserTweetsQuery);
  response.send(
    UserTweets.map((eachTweet) => {
      return {
        tweet: eachTweet.tweet,
        likes: eachTweet.likes,
        replies: eachTweet.replies,
        dateTime: eachTweet.dateTime,
      };
    })
  );
});

//API-10
app.post("/user/tweets/", authenticateJwtToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = request.user_id;
  const currentDateTime = new Date();
  const formatedDateTime = format(
    new Date(currentDateTime),
    "yyyy-MM-dd HH:mm:ss"
  );
  const postTweetQuery = `
  INSERT INTO tweet (
      tweet,
      user_id,
      date_time
  ) VALUES(
      '${tweet}',
      ${userId},
      '${formatedDateTime}'
  );
  `;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

//API-11
app.delete(
  "/tweets/:tweetId/",
    ,
  async (request, response) => {
    const tweetId = parseInt(request.params.tweetId);
    const userId = request.user_id;
    const getUserTweetQuery = `SELECT tweet_id FROM tweet where user_id = ${userId};`;
    const tweetIds = await db.all(getUserTweetQuery);
    const tweetIdArray = tweetIds.map((eachTweet) => eachTweet.tweet_id);
    if (tweetIdArray.includes(tweetId)) {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
