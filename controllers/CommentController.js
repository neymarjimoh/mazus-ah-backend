import models from '../database/models';
import ServerResponse from '../modules';
import Notification from '../helpers/Notification';

const { successResponse, errorResponse } = ServerResponse;
const {
  Comment,
  Like,
  User,
  Profile,
  Article,
  CommentHistory
} = models;

/**
 * @class CommentController
 * @exports CommentController
 */
export default class CommentController {
  /**
   *
   * @method postComment
   * @description Posts a comment
   * @param {object} req express request object
   * @param {object} res express response object
   * @param {fucntion} next
   * @returns {object} returns comment info
   * @memberof commentController
   */
  static async postComment(req, res, next) {
    try {
      const { body, highlightedText } = req.body;
      const { slug } = req.params;
      const { id: userId, firstName, lastName } = req.user;

      const article = await Article.findOne({ where: { slug } });
      if (!article) return errorResponse(res, 404, { article: 'That article does not exist' });
      const { id, title, status } = article.dataValues;
      if (status !== 'published') return errorResponse(res, 405, 'cannot comment on a draft article');

      if (highlightedText) {
        const articleComment = await Comment.create({
          body,
          userId,
          articleId: id,
          articleSlug: slug,
          highlightedText,
          containsHighlightedText: true,
        });
        const userWithProfile = await User.findOne({
          where: { id: userId },
          include: [
            {
              model: Profile,
              as: 'profile',
            },
          ]
        });
        const response = {
          ...articleComment.dataValues,
          user: userWithProfile,
        };
        Notification.newComment(slug, id, title, firstName, lastName);
        return successResponse(res, 201, 'comment', response);
      }

      // Threaded comments
      if (req.query.commtId) {
        const parentCommentId = req.query.commtId;

        // get parent comment
        const parentComment = await models.Comment.findByPk(parentCommentId);

        // create new child comment
        const newChildComment = await models.Comment.create({
          body,
          userId,
          articleId: id,
          articleSlug: slug,
          type: 'child'
        });

        // Create relationship
        await parentComment.addChildComments(newChildComment);
        const userWithProfile = await User.findOne({
          where: { id: userId },
          include: [
            {
              model: Profile,
              as: 'profile',
            },
          ]
        });
        const response = {
          ...newChildComment.dataValues,
          user: userWithProfile,
        };

        return successResponse(res, 201, 'comment', response);
      }

      const articleComment = await Comment.create({
        body,
        userId,
        articleId: id,
        articleSlug: slug,
      });
      Notification.newComment(slug, id, title, firstName, lastName);
      const userWithProfile = await User.findOne({
        where: { id: userId },
        include: [
          {
            model: Profile,
            as: 'profile',
          },
        ]
      });
      const response = {
        ...articleComment.dataValues,
        user: userWithProfile,
      };
      return successResponse(res, 201, 'comment', response);
    } catch (error) {
      return next(error);
    }
  }


  /**
   * Method to like a single comment
   *
   * @static
   * @param {object} req
   * @param {object} res
   * @param {function} next
   * @returns {object} details of the liked comment
   * @memberof CommentController
   */
  static async likeComment(req, res, next) {
    try {
      const { commentId } = req.params;
      const { id } = req.user;

      const foundComment = await Comment.findOne({
        where: {
          id: commentId,
        }
      });

      if (!foundComment) {
        return errorResponse(res, 404, { comment: 'That comment does not exist' });
      }
      const { articleId } = foundComment.dataValues;
      const alreadyLiked = await Like.findOne({
        where: {
          commentId,
          userId: id,
        }
      });

      if (alreadyLiked) {
        await Like.destroy({
          where: {
            commentId
          }
        });

        await Comment.update(
          {
            likes: foundComment.dataValues.likes - 1,
          },
          {
            where: {
              id: foundComment.dataValues.id,
            }
          }
        );

        return successResponse(res, 200, 'comment', { message: '\'Like\' has been removed' });
      }

      const like = await Like.create({
        commentId,
        userId: id,
        articleId,
        like: true,
      });

      await Comment.update(
        {
          likes: foundComment.dataValues.likes + 1,
        },
        {
          where: {
            id: foundComment.dataValues.id,
          }
        }
      );
      return successResponse(res, 201, 'comment', { message: 'Comment liked', like });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Method to edit a comment
   *
   * @static
   * @param {object} req
   * @param {object} res
   * @param {function} next
   * @returns {object} details of the edited comment
   * @memberof CommentController
   */
  static async editComment(req, res, next) {
    try {
      const { id } = req.user;
      const { commentId } = req.params;
      const { body } = req.body;
      const comment = await Comment.findOne({ where: { id: commentId } });
      if (!comment) {
        return errorResponse(res, 404, { message: 'Comment does not exist' });
      }
      if (comment.dataValues.userId !== id) {
        return errorResponse(res, 403, 'You are not allowed to edit another user\'s comment');
      }
      await CommentHistory.create({
        userId: id,
        commentId,
        oldComment: comment.body,
      });
      const editedComment = await Comment.update(
        {
          body
        },
        {
          where: { id: commentId },
          returning: true
        }
      );
      return successResponse(res, 200, 'comment', editedComment[1][0]);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Method to get a comment edit history
   *
   * @static
   * @param {object} req
   * @param {object} res
   * @param {function} next
   * @returns {object} details of the edited comment
   * @memberof CommentController
   */
  static async getEditCommentHistory(req, res, next) {
    try {
      const { commentId } = req.params;
      const commentHistory = await CommentHistory.findAll({
        where: { commentId },
        order: [
          ['updatedAt', 'DESC'],
        ],
      });
      return successResponse(res, 200, 'commentHistory', commentHistory);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Method to get  an article comments and their likes
   *
   * @static
   * @param {object} req
   * @param {object} res
   * @param {function} next
   * @returns {object} details of the edited comment
   * @memberof CommentController
   */
  static async getArticleComments(req, res, next) {
    const { articleId } = req.params;
    try {
      const commentsLike = await Like.findAll({ where: { articleId }, attributes: ['userId', 'articleId', 'like', 'commentId'] });
      return successResponse(res, 200, 'commentsLike', commentsLike);
    } catch (error) {
      return next(error)
    }
  }
}
